import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Ban, Plus, Trash2 } from 'lucide-react';
import {
  ACCOUNT_TYPES, categoryLabel, CURRENCY_CODES, EXPENSE_CATEGORIES, INCOME_CATEGORIES, OBLIGATION_KINDS, parseAmount,
  type AccountDoc, type BudgetDoc, type Currency, type FinanceSummary, type ObligationDoc, type TransactionDoc,
} from '@lifeos/contracts';
import { db } from '../services/firebase';
import { call, newId } from '../services/api';
import { useSpace } from '../hooks/session';
import { useQueryLive } from '../hooks/useLive';
import { Badge, Button, Card, Empty, ErrorBox, Field, FormFooter, inputCls, Loading, Modal, PageHeader, Tabs, useAction } from '../components/ui';
import { dayLabel, money, todayIn } from '../lib/format';

type Tab = 'resumen' | 'movimientos' | 'cuentas' | 'pagos' | 'presupuestos';
type Account = AccountDoc & { id: string };
const ACCOUNT_LABEL: Record<string, string> = { cash: 'Efectivo', bank: 'Cuenta bancaria', wallet: 'Billetera digital', credit: 'Tarjeta de crédito', other: 'Otra' };
const KIND_LABEL: Record<string, string> = { bill: 'Factura / servicio', debt: 'Deuda / préstamo', expected: 'Cobro esperado', subscription: 'Suscripción' };
const OB_STATUS: Record<string, [string, 'warn' | 'brand' | 'ok' | 'neutral']> = { open: ['Pendiente', 'warn'], partial: ['Pago parcial', 'brand'], settled: ['Liquidada', 'ok'], cancelled: ['Cancelada', 'neutral'] };

/** Monto escrito ("1,250.50") → unidades menores, o error legible. */
function amountOf(text: string, currency: Currency) {
  const v = parseAmount(text, currency);
  if (!v) throw new Error('Monto inválido. Usa por ejemplo 1250.50');
  return v;
}

function useAccounts() {
  const { spaceId } = useSpace();
  return useQueryLive<AccountDoc>(() => query(collection(db, 'spaces', spaceId, 'accounts'), where('archived', '==', false), orderBy('name')), `acc:${spaceId}`);
}

function AccountSelect({ accounts, currency, name = 'accountId', optional = true }: { accounts: Account[]; currency?: string; name?: string; optional?: boolean }) {
  const list = currency ? accounts.filter((a) => a.currency === currency) : accounts;
  return (
    <select name={name} className={inputCls} required={!optional} defaultValue="">
      {optional ? <option value="">Sin cuenta</option> : <option value="" disabled>Selecciona una cuenta</option>}
      {list.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
    </select>
  );
}

function TxForm({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const { spaceId, space } = useSpace();
  const [kind, setKind] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [currency, setCurrency] = useState<Currency>(space.currency);
  const { busy, error, run, clear } = useAction();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const ok = await run(async () => {
      if (kind === 'transfer') {
        const from = accounts.find((a) => a.id === f.fromAccountId);
        const to = accounts.find((a) => a.id === f.toAccountId);
        if (!from || !to) throw new Error('Elige las dos cuentas.');
        return call('tx.transfer', spaceId, {
          requestId: newId(), fromAccountId: from.id, toAccountId: to.id, amount: amountOf(f.amount!, from.currency),
          toAmount: from.currency !== to.currency ? amountOf(f.toAmount ?? '', to.currency) : undefined, date: f.date!, description: f.description || undefined,
        });
      }
      return call('tx.record', spaceId, {
        requestId: newId(), kind, amount: amountOf(f.amount!, currency), currency, category: f.category!,
        accountId: f.accountId || undefined, description: f.description || undefined, date: f.date!,
      });
    }, 'Movimiento registrado');
    if (ok) onClose();
  }
  const cats = kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const cross = kind === 'transfer' && from && to && accounts.find((a) => a.id === from)?.currency !== accounts.find((a) => a.id === to)?.currency;
  return (
    <form onSubmit={submit} onChange={clear} className="space-y-3">
      <Tabs value={kind} onChange={setKind} options={[['expense', 'Gasto'], ['income', 'Ingreso'], ['transfer', 'Transferencia']]} />
      {kind === 'transfer' ? (
        <>
          {accounts.length < 2 && <p className="text-sm text-warn-700">Necesitas al menos dos cuentas para transferir.</p>}
          <Field label="Desde"><select name="fromAccountId" required className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)}><option value="" disabled>Selecciona una cuenta</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select></Field>
          <Field label="Hacia"><select name="toAccountId" required className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}><option value="" disabled>Selecciona una cuenta</option>{accounts.filter((a) => a.id !== from).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select></Field>
          <Field label="Monto enviado"><input name="amount" required inputMode="decimal" className={inputCls} /></Field>
          {cross && <Field label="Monto recibido" hint="Las cuentas tienen monedas distintas: indica cuánto llegó (define el tipo de cambio)."><input name="toAmount" required inputMode="decimal" className={inputCls} /></Field>}
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><Field label="Monto"><input name="amount" required inputMode="decimal" placeholder="0.00" className={inputCls} autoFocus /></Field></div>
            <Field label="Moneda"><select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className={inputCls}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          </div>
          <Field label="Categoría"><select name="category" required className={inputCls} defaultValue="">{<option value="" disabled>Selecciona una opción</option>}{Object.entries(cats).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Cuenta" hint="Opcional. Ajusta el saldo calculado de la cuenta."><AccountSelect accounts={accounts} currency={currency} /></Field>
        </>
      )}
      <Field label="Descripción"><input name="description" maxLength={200} className={inputCls} /></Field>
      <Field label="Fecha"><input name="date" type="date" required defaultValue={todayIn(space.timezone)} className={inputCls} /></Field>
      <FormFooter busy={busy} error={error} onCancel={onClose} submit="Registrar" />
    </form>
  );
}

function Transactions({ accounts }: { accounts: Account[] }) {
  const { spaceId, space, can } = useSpace();
  const { error, run } = useAction();
  const list = useQueryLive<TransactionDoc>(() => query(collection(db, 'spaces', spaceId, 'transactions'), orderBy('occurredAt', 'desc'), limit(100)), `tx:${spaceId}`);
  const name = (id: string | null) => accounts.find((a) => a.id === id)?.name;
  if (list.loading) return <Loading />;
  if (list.error) return <ErrorBox error={list.error} />;
  if (!list.data.length) return <Empty text="Aún no hay movimientos. Regístralos aquí o escríbele al bot: «Gasté Q90 en almuerzo»." />;
  return (
    <>
      {error ? <ErrorBox error={error} /> : null}
      <ul className="divide-y divide-line rounded-[--radius-card] border border-line bg-surface px-4">
        {list.data.map((t) => {
          const Icon = t.kind === 'income' ? ArrowDownLeft : t.kind === 'expense' ? ArrowUpRight : ArrowLeftRight;
          const voided = t.status === 'voided';
          return (
            <li key={t.id} className={`flex items-center gap-3 py-3 ${voided ? 'opacity-60' : ''}`}>
              <Icon className={`size-5 shrink-0 ${t.kind === 'income' ? 'text-ok-700' : t.kind === 'expense' ? 'text-danger-700' : 'text-brand-600'}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className={`font-medium ${voided ? 'line-through' : ''}`}>{t.description || categoryLabel(t.kind, t.category)}</p>
                <p className="flex flex-wrap gap-1.5 text-xs text-ink-soft">
                  {dayLabel(t.date, space.timezone)} · {t.kind === 'transfer' ? `${name(t.accountId)} → ${name(t.toAccountId)}` : categoryLabel(t.kind, t.category)}
                  {t.kind !== 'transfer' && name(t.accountId) && <> · {name(t.accountId)}</>}
                  {voided && <Badge tone="danger">Anulado: {t.voidReason}</Badge>}
                  {t.source === 'telegram' && <Badge>Telegram</Badge>}
                </p>
              </div>
              <span className={`font-semibold ${t.kind === 'income' ? 'text-ok-700' : ''}`}>{t.kind === 'expense' ? '−' : t.kind === 'income' ? '+' : ''}{money(t.amount, t.currency)}</span>
              {can('finance.write') && !voided && (
                <button aria-label="Anular movimiento" className="grid size-9 place-items-center rounded-full text-ink-soft hover:bg-paper" onClick={() => {
                  const reason = prompt('Motivo de la anulación (queda registrado):');
                  if (reason?.trim()) run(() => call('tx.void', spaceId, { txId: t.id, reason: reason.trim() }), 'Movimiento anulado');
                }}><Ban className="size-4" /></button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Accounts({ accounts, loading, err }: { accounts: Account[]; loading: boolean; err: unknown }) {
  const { spaceId, space, can } = useSpace();
  const [open, setOpen] = useState(false);
  const { busy, error, run, clear } = useAction();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const cur = f.currency as Currency;
    const ok = await run(() => {
      const raw = (f.opening ?? '').trim();
      const neg = raw.startsWith('-');
      const opening = raw && raw !== '0' ? amountOf(raw.replace(/^-/, ''), cur) * (neg ? -1 : 1) : 0;
      return call('account.create', spaceId, { requestId: newId(), name: f.name!, type: f.type as never, currency: cur, openingBalance: opening });
    }, 'Cuenta creada');
    if (ok) setOpen(false);
  }
  const totals: Record<string, number> = {};
  accounts.forEach((a) => (totals[a.currency] = (totals[a.currency] ?? 0) + a.balance));
  return (
    <>
      <p className="mb-3 text-sm text-ink-soft">Saldos calculados con lo que registras en la app. No hay conexión con bancos.</p>
      {loading ? <Loading /> : err ? <ErrorBox error={err} /> : !accounts.length ? <Empty text="Crea tus cuentas (efectivo, banco, tarjeta) para llevar saldos." /> : (
        <ul className="divide-y divide-line rounded-[--radius-card] border border-line bg-surface px-4">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-3">
              <div className="flex-1"><p className="font-medium">{a.name}</p><p className="text-xs text-ink-soft">{ACCOUNT_LABEL[a.type]} · {a.currency}</p></div>
              <span className={`font-semibold ${a.balance < 0 ? 'text-danger-700' : ''}`}>{money(a.balance, a.currency)}</span>
              {can('finance.write') && <button aria-label={`Archivar ${a.name}`} className="grid size-9 place-items-center rounded-full text-ink-soft hover:bg-paper" onClick={() => confirm(`¿Archivar la cuenta ${a.name}? Sus movimientos se conservan.`) && run(() => call('account.update', spaceId, { accountId: a.id, archived: true }), 'Cuenta archivada')}><Trash2 className="size-4" /></button>}
            </li>
          ))}
          {Object.entries(totals).map(([c, v]) => <li key={c} className="flex justify-between py-3 font-bold"><span>Total {c}</span><span>{money(v, c)}</span></li>)}
        </ul>
      )}
      {can('finance.write') && <Button className="mt-4" onClick={() => setOpen(true)}><Plus className="size-4" />Nueva cuenta</Button>}
      <Modal open={open} onClose={() => setOpen(false)} title="Nueva cuenta">
        {open && (
          <form onSubmit={submit} onChange={clear} className="space-y-3">
            <Field label="Nombre"><input name="name" required maxLength={60} className={inputCls} autoFocus /></Field>
            <Field label="Tipo"><select name="type" required className={inputCls} defaultValue=""><option value="" disabled>Selecciona una opción</option>{ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{ACCOUNT_LABEL[t]}</option>)}</select></Field>
            <Field label="Moneda"><select name="currency" defaultValue={space.currency} className={inputCls}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Saldo inicial" hint="Lo que tienes hoy en esa cuenta. Negativo para deuda de tarjeta (ej. -500)."><input name="opening" inputMode="decimal" placeholder="0.00" className={inputCls} /></Field>
            <FormFooter busy={busy} error={error} onCancel={() => setOpen(false)} />
          </form>
        )}
      </Modal>
    </>
  );
}

function Obligations({ accounts }: { accounts: Account[] }) {
  const { spaceId, space, can } = useSpace();
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<(ObligationDoc & { id: string }) | null>(null);
  const [show, setShow] = useState<'abiertas' | 'todas'>('abiertas');
  const { busy, error, run, clear } = useAction();
  const col = collection(db, 'spaces', spaceId, 'obligations');
  const list = useQueryLive<ObligationDoc>(() => (show === 'abiertas' ? query(col, where('status', 'in', ['open', 'partial']), limit(200)) : query(col, orderBy('createdAt', 'desc'), limit(100))), `ob:${spaceId}:${show}`);
  const sorted = [...list.data].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const today = todayIn(space.timezone);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const cur = f.currency as Currency;
    const ok = await run(() => call('obligation.create', spaceId, {
      requestId: newId(), direction: f.direction as never, kind: f.kind as never, title: f.title!, counterparty: f.counterparty || undefined,
      amount: amountOf(f.amount!, cur), currency: cur, dueDate: f.dueDate || undefined,
      remindDaysBefore: f.dueDate && f.remind !== '' ? Number(f.remind) : undefined,
    }), 'Registrado');
    if (ok) setCreating(false);
  }
  async function pay(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const ok = await run(() => call('obligation.pay', spaceId, { requestId: newId(), obligationId: paying!.id, amount: amountOf(f.amount!, paying!.currency), accountId: f.accountId || undefined, date: f.date! }), 'Pago registrado');
    if (ok) setPaying(null);
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <Tabs value={show} onChange={setShow} options={[['abiertas', 'Pendientes'], ['todas', 'Todas']]} />
        {can('finance.write') && <Button onClick={() => setCreating(true)}><Plus className="size-4" />Nueva</Button>}
      </div>
      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : !sorted.length ? <Empty text="No hay pagos ni cobros pendientes." /> : (
        <ul className="divide-y divide-line rounded-[--radius-card] border border-line bg-surface px-4">
          {sorted.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{o.title}</p>
                <p className="flex flex-wrap gap-1.5 text-xs text-ink-soft">
                  <Badge tone={o.direction === 'payable' ? 'warn' : 'ok'}>{o.direction === 'payable' ? 'Por pagar' : 'Por cobrar'}</Badge>
                  <Badge tone={OB_STATUS[o.status]![1]}>{OB_STATUS[o.status]![0]}</Badge>
                  {KIND_LABEL[o.kind]}{o.counterparty && ` · ${o.counterparty}`}
                  {o.dueDate && <span className={o.dueDate < today && o.status !== 'settled' ? 'font-semibold text-danger-700' : ''}>· vence {dayLabel(o.dueDate, space.timezone)}</span>}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold">{money(o.amount - o.paid, o.currency)}</p>
                {o.paid > 0 && <p className="text-xs text-ink-soft">de {money(o.amount, o.currency)}</p>}
              </div>
              {can('finance.write') && ['open', 'partial'].includes(o.status) && (
                <div className="flex gap-1">
                  <Button variant="secondary" onClick={() => setPaying(o)}>{o.direction === 'payable' ? 'Pagar' : 'Cobrar'}</Button>
                  <button aria-label="Cancelar obligación" className="grid size-11 place-items-center rounded-full text-ink-soft hover:bg-paper" onClick={() => confirm('¿Cancelar? Los pagos ya registrados se conservan.') && run(() => call('obligation.cancel', spaceId, { obligationId: o.id }), 'Cancelada')}><Ban className="size-4" /></button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && !creating && !paying ? <div className="mt-3"><ErrorBox error={error} /></div> : null}
      <Modal open={creating} onClose={() => setCreating(false)} title="Nuevo pago o cobro">
        {creating && (
          <form onSubmit={create} onChange={clear} className="space-y-3">
            <Field label="Tipo"><select name="direction" required className={inputCls} defaultValue=""><option value="" disabled>Selecciona una opción</option><option value="payable">Tengo que pagar</option><option value="receivable">Me tienen que pagar</option></select></Field>
            <Field label="Clase"><select name="kind" className={inputCls}>{OBLIGATION_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
            <Field label="Concepto"><input name="title" required maxLength={120} className={inputCls} /></Field>
            <Field label="Persona o empresa"><input name="counterparty" maxLength={80} className={inputCls} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2"><Field label="Monto"><input name="amount" required inputMode="decimal" className={inputCls} /></Field></div>
              <Field label="Moneda"><select name="currency" defaultValue={space.currency} className={inputCls}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            </div>
            <Field label="Vence"><input name="dueDate" type="date" className={inputCls} /></Field>
            <Field label="Recordarme"><select name="remind" className={inputCls} defaultValue="1"><option value="">No recordar</option><option value="0">El mismo día (8:00)</option><option value="1">1 día antes</option><option value="3">3 días antes</option><option value="7">7 días antes</option></select></Field>
            <p className="text-xs text-ink-soft">Registrar una obligación no mueve dinero: el ingreso o gasto se registra cuando marques el pago.</p>
            <FormFooter busy={busy} error={error} onCancel={() => setCreating(false)} />
          </form>
        )}
      </Modal>
      <Modal open={!!paying} onClose={() => setPaying(null)} title={paying?.direction === 'payable' ? 'Registrar pago' : 'Registrar cobro'}>
        {paying && (
          <form onSubmit={pay} onChange={clear} className="space-y-3">
            <p className="text-sm">{paying.title} · pendiente <b>{money(paying.amount - paying.paid, paying.currency)}</b></p>
            <Field label="Monto" hint="Puede ser parcial."><input name="amount" required inputMode="decimal" defaultValue={((paying.amount - paying.paid) / 100).toFixed(2)} className={inputCls} /></Field>
            <Field label="Cuenta"><AccountSelect accounts={accounts} currency={paying.currency} /></Field>
            <Field label="Fecha"><input name="date" type="date" required defaultValue={today} className={inputCls} /></Field>
            <FormFooter busy={busy} error={error} onCancel={() => setPaying(null)} submit="Registrar" />
          </form>
        )}
      </Modal>
    </>
  );
}

function Summary() {
  const { spaceId, space, can } = useSpace();
  const [month, setMonth] = useState(todayIn(space.timezone).slice(0, 7));
  const [data, setData] = useState<FinanceSummary | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const budgets = useQueryLive<BudgetDoc>(() => collection(db, 'spaces', spaceId, 'budgets') as never, `bud:${spaceId}`);
  const { busy, error, run, clear } = useAction();
  useEffect(() => {
    setData(null);
    setErr(null);
    call('finance.summary', spaceId, { month }).then(setData, setErr);
  }, [spaceId, month, budgets.data.length]);

  async function saveBudget(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const cur = f.currency as Currency;
    const ok = await run(() => call('budget.set', spaceId, { category: f.category!, limit: amountOf(f.limit!, cur), currency: cur }), 'Presupuesto guardado');
    if (ok) setOpen(false);
  }

  return (
    <div className="space-y-4">
      <Field label="Mes"><input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={`${inputCls} max-w-48`} /></Field>
      {err ? <ErrorBox error={err} /> : !data ? <Loading /> : (
        <>
          {!Object.keys(data.totals).length && <Empty text="No hay movimientos en este mes." />}
          {Object.entries(data.totals).map(([cur, t]) => {
            const cats = Object.entries(data.byCategory[cur] ?? {}).sort((a, b) => b[1] - a[1]);
            const max = cats[0]?.[1] ?? 1;
            return (
              <Card key={cur} title={`Resumen en ${cur}`}>
                <div className="mb-4 grid grid-cols-3 gap-2 text-sm">
                  <div><p className="text-ink-soft">Ingresos</p><p className="text-lg font-bold text-ok-700">{money(t.income, cur)}</p></div>
                  <div><p className="text-ink-soft">Gastos</p><p className="text-lg font-bold text-danger-700">{money(t.expense, cur)}</p></div>
                  <div><p className="text-ink-soft">Balance</p><p className="text-lg font-bold">{money(t.income - t.expense, cur)}</p></div>
                </div>
                {cats.length > 0 && <h3 className="mb-2 text-sm font-semibold">Gasto por categoría</h3>}
                <ul className="space-y-2">
                  {cats.map(([c, v]) => (
                    <li key={c} className="text-sm">
                      <div className="flex justify-between"><span>{categoryLabel('expense', c)}</span><span className="font-medium">{money(v, cur)}</span></div>
                      <div className="mt-1 h-2 rounded-full bg-paper"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${(v / max) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
          {data.truncated && <p className="text-sm text-warn-700">Resumen parcial: el mes tiene demasiados movimientos.</p>}
          <Card title="Presupuestos mensuales" action={can('finance.write') && <Button variant="secondary" onClick={() => setOpen(true)}><Plus className="size-4" />Presupuesto</Button>}>
            {!data.budgets.length ? <Empty text="Define un límite mensual por categoría para recibir alertas al 80%." /> : (
              <ul className="space-y-3">
                {data.budgets.map((b) => {
                  const pct = Math.round((b.spent / b.limit) * 100);
                  return (
                    <li key={`${b.category}${b.currency}`} className="text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{categoryLabel('expense', b.category)}</span>
                        <span>{money(b.spent, b.currency)} / {money(b.limit, b.currency)} <b className={pct >= 100 ? 'text-danger-700' : pct >= 80 ? 'text-warn-700' : ''}>({pct}%)</b></span>
                        {can('finance.write') && <button aria-label="Quitar presupuesto" className="text-ink-soft" onClick={() => run(() => call('budget.remove', spaceId, { category: b.category }), 'Presupuesto quitado')}><Trash2 className="size-4" /></button>}
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-paper" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                        <div className={`h-2 rounded-full ${pct >= 100 ? 'bg-danger-700' : pct >= 80 ? 'bg-warn-700' : 'bg-ok-700'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Presupuesto mensual">
        {open && (
          <form onSubmit={saveBudget} onChange={clear} className="space-y-3">
            <Field label="Categoría"><select name="category" required className={inputCls} defaultValue=""><option value="" disabled>Selecciona una opción</option>{Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2"><Field label="Límite"><input name="limit" required inputMode="decimal" className={inputCls} /></Field></div>
              <Field label="Moneda"><select name="currency" defaultValue={space.currency} className={inputCls}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            </div>
            <FormFooter busy={busy} error={error} onCancel={() => setOpen(false)} />
          </form>
        )}
      </Modal>
    </div>
  );
}

export default function Finance() {
  const { can } = useSpace();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'resumen';
  const accounts = useAccounts();
  const creating = params.get('nuevo') === 'movimiento';
  return (
    <div>
      <PageHeader title="Finanzas" action={can('finance.write') && <Button onClick={() => setParams({ tab, nuevo: 'movimiento' })}><Plus className="size-4" />Movimiento</Button>} />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} options={[['resumen', 'Resumen'], ['movimientos', 'Movimientos'], ['cuentas', 'Cuentas'], ['pagos', 'Pagos y cobros']]} />
      {tab === 'resumen' && <Summary />}
      {tab === 'movimientos' && <Transactions accounts={accounts.data} />}
      {tab === 'cuentas' && <Accounts accounts={accounts.data} loading={accounts.loading} err={accounts.error} />}
      {tab === 'pagos' && <Obligations accounts={accounts.data} />}
      <Modal open={creating} onClose={() => setParams({ tab })} title="Nuevo movimiento">
        {creating && <TxForm accounts={accounts.data} onClose={() => setParams({ tab })} />}
      </Modal>
    </div>
  );
}
