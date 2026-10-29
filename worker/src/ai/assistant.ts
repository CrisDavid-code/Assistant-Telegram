import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';
import {
  can, categoryLabel, formatMoney, parseAmount, type AccountDoc, type Currency, type OpData, type OpName,
} from '@lifeos/contracts';
import { db, FieldValue, Timestamp } from '../shared/firebase';
import { DomainError } from '../shared/errors';
import { nowIn, todayIn } from '../shared/time';
import type { Ctx } from '../auth/context';
import { assistantHandlers, runOp, type Caller } from '../api/registry';
import * as tasks from '../tasks/service';
import * as finance from '../finance/service';
import { searchContacts } from '../contacts/service';
import { extractWhen } from './dates';
import { interpret } from './provider';
import type { Intent, InterpretContext } from './types';

// Motor del asistente (Telegram y PWA). La IA solo PROPONE una intención; aquí se completa, se valida y
// se ejecuta SIEMPRE mediante runOp, que vuelve a autorizar. Las operaciones financieras piden confirmación.

export interface Choice { label: string; patch: Record<string, unknown> }
export interface Reply { text: string; actionId?: string; choices?: string[] }

interface Pending { id: string; op: OpName; spaceId: string; data: Record<string, unknown>; choices: Choice[]; expiresAt: Timestamp }
interface Awaiting { intent: Intent; field: 'when' | 'amount'; spaceId: string; expiresAt: Timestamp }
interface Conversation { uid: string; spaceId?: string; pending?: Pending | null; awaiting?: Awaiting | null }

const TTL_MS = 10 * 60_000;
const convRef = (key: string) => db.doc(`conversations/${key}`);
const newId = () => randomBytes(9).toString('base64url');
const fmtWhen = (d: Date, tz: string) => DateTime.fromJSDate(d, { zone: tz }).setLocale('es').toFormat("ccc d 'de' LLL, HH:mm");
const fmtDay = (iso: string, tz: string) => (iso === todayIn(tz) ? 'hoy' : DateTime.fromISO(iso, { zone: tz }).setLocale('es').toFormat("cccc d 'de' LLLL"));

export const HELP = [
  'Puedo registrar y consultar tu información. Ejemplos:',
  '• Recuérdame mañana a las 8 pagar el internet',
  '• Gasté Q125 en gasolina y pagué en efectivo',
  '• Me pagaron Q3,800 de salario',
  '• Juan me debe Q800 y me pagará el viernes',
  '• Tengo que llamar a María mañana',
  '• ¿Qué pendientes tengo hoy? · ¿Cuánto he gastado este mes?',
  '• ¿Cuánto dinero tengo? · ¿Qué pagos vencen esta semana?',
].join('\n');

function ictx(ctx: Ctx): InterpretContext {
  const now = nowIn(ctx.space.timezone);
  return { today: now.toISODate()!, now: now.toISO()!, timezone: ctx.space.timezone, currency: ctx.space.currency, spaceId: ctx.spaceId };
}

async function saveConv(key: string, uid: string, patch: Partial<Conversation>) {
  await convRef(key).set({ uid, ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

async function propose(key: string, ctx: Ctx, op: OpName, data: Record<string, unknown>, summary: string, choices?: Choice[]): Promise<Reply> {
  const id = newId();
  const list = choices ?? [{ label: '✅ Confirmar', patch: {} }];
  await saveConv(key, ctx.uid, { pending: { id, op, spaceId: ctx.spaceId, data: { ...data, requestId: id }, choices: list, expiresAt: Timestamp.fromMillis(Date.now() + TTL_MS) }, awaiting: null });
  return { text: `${summary}\n¿Confirmas?`, actionId: id, choices: list.map((c) => c.label) };
}

async function ask(key: string, ctx: Ctx, intent: Intent, field: Awaiting['field'], question: string): Promise<Reply> {
  await saveConv(key, ctx.uid, { awaiting: { intent, field, spaceId: ctx.spaceId, expiresAt: Timestamp.fromMillis(Date.now() + TTL_MS) }, pending: null });
  return { text: question };
}

/** Elige la cuenta: por pista ("efectivo", "tarjeta", nombre), única en la moneda, o se pregunta. */
async function accountChoices(ctx: Ctx, currency: Currency, hint?: string): Promise<{ accountId?: string; choices?: Choice[]; label?: string }> {
  const accounts = (await finance.getBalances(ctx)).filter((a) => a.currency === currency);
  const h = hint?.toLowerCase();
  const byHint = h
    ? accounts.find((a) => a.name.toLowerCase().includes(h.replace(/^cuenta\s+(de\s+)?/, ''))) ??
      accounts.find((a) => (h === 'efectivo' && a.type === 'cash') || (h.startsWith('tarjeta') && a.type === 'credit'))
    : undefined;
  const one = byHint ?? (accounts.length === 1 ? accounts[0] : undefined);
  if (one) return { accountId: one.id, label: one.name };
  if (!accounts.length) return {};
  return {
    choices: [
      ...accounts.slice(0, 6).map((a: AccountDoc & { id: string }) => ({ label: `💳 ${a.name}`, patch: { accountId: a.id } })),
      { label: 'Sin cuenta', patch: {} },
    ],
  };
}

async function plan(key: string, ctx: Ctx, intent: Intent): Promise<Reply> {
  const tz = ctx.space.timezone;
  const where = ctx.space.type === 'personal' ? 'tu espacio personal' : `«${ctx.space.name}»`;
  switch (intent.type) {
    case 'help':
      return { text: HELP };
    case 'unknown':
      return { text: `No entendí del todo. ${HELP}` };

    case 'reminder': {
      if (!intent.date || !intent.time) return ask(key, ctx, intent, 'when', intent.date ? '¿A qué hora quieres que te lo recuerde?' : '¿Qué día y a qué hora quieres que te lo recuerde?');
      await runOp(callerOf(ctx), 'reminder.create', ctx.spaceId, { requestId: newId(), title: intent.title, at: `${intent.date}T${intent.time}`, recurrence: intent.recurrence });
      const when = DateTime.fromISO(`${intent.date}T${intent.time}`, { zone: tz }).toJSDate();
      const rep = intent.recurrence ? ` (se repite: ${{ daily: 'cada día', weekly: 'cada semana', monthly: 'cada mes', yearly: 'cada año' }[intent.recurrence.freq]})` : '';
      return { text: `✅ Te lo recordaré el ${fmtWhen(when, tz)}${rep}:\n${intent.title}` };
    }
    case 'task': {
      await runOp(callerOf(ctx), 'task.create', ctx.spaceId, { requestId: newId(), title: intent.title, dueDate: intent.date, dueTime: intent.date ? intent.time : undefined });
      return { text: `✅ Tarea agregada en ${where}: ${intent.title}${intent.date ? ` (para ${fmtDay(intent.date, tz)}${intent.time ? ` a las ${intent.time}` : ''})` : ''}` };
    }

    case 'expense':
    case 'income': {
      if (!can(ctx.role, 'finance.write')) return { text: 'Tu rol en este espacio no permite registrar movimientos financieros.' };
      if (!intent.amount) return ask(key, ctx, intent, 'amount', intent.type === 'expense' ? '¿De cuánto fue el gasto?' : '¿De cuánto fue el ingreso?');
      const currency = (intent.currency ?? ctx.space.currency) as Currency;
      const date = intent.date ?? todayIn(tz);
      const acc = await accountChoices(ctx, currency, intent.accountHint);
      const data: OpData<'tx.record'> = {
        requestId: '', kind: intent.type, amount: intent.amount, currency, category: intent.category,
        description: intent.description || undefined, date, accountId: acc.accountId,
      };
      const what = intent.type === 'expense' ? 'un gasto' : 'un ingreso';
      const summary = `Voy a registrar ${what} de ${formatMoney(intent.amount, currency)} en ${categoryLabel(intent.type, intent.category)}` +
        `${intent.description ? ` (${intent.description})` : ''}${acc.label ? `, cuenta ${acc.label}` : ''}, con fecha de ${fmtDay(date, tz)}, en ${where}.`;
      return propose(key, ctx, 'tx.record', data, acc.choices ? `${summary}\n¿Con qué cuenta?` : summary, acc.choices);
    }

    case 'debt': {
      if (!can(ctx.role, 'finance.write')) return { text: 'Tu rol en este espacio no permite registrar deudas ni cobros.' };
      if (!intent.amount) return ask(key, ctx, intent, 'amount', '¿De cuánto es?');
      const currency = (intent.currency ?? ctx.space.currency) as Currency;
      const title = intent.title ?? (intent.direction === 'receivable' ? `Cobro a ${intent.counterparty ?? 'cliente'}` : `Pago a ${intent.counterparty ?? 'acreedor'}`);
      const data: OpData<'obligation.create'> = {
        requestId: '', direction: intent.direction, kind: intent.kind, title, counterparty: intent.counterparty,
        amount: intent.amount, currency, dueDate: intent.dueDate, remindDaysBefore: intent.dueDate ? 0 : undefined,
      };
      const verb = intent.direction === 'receivable' ? 'cobrar' : 'pagar';
      return propose(key, ctx, 'obligation.create', data,
        `Voy a registrar que tienes por ${verb} ${formatMoney(intent.amount, currency)}${intent.counterparty ? ` (${intent.counterparty})` : ''}` +
        `${intent.dueDate ? `, con vencimiento ${fmtDay(intent.dueDate, tz)} y recordatorio ese día a las 08:00` : ''}, en ${where}. No es dinero recibido todavía.`);
    }

    case 'contact': {
      const data: OpData<'contact.create'> = {
        requestId: '', name: intent.name, phones: intent.phone ? [intent.phone] : [], emails: intent.email ? [intent.email] : [],
        company: intent.company, tags: [], relation: 'other',
      };
      return propose(key, ctx, 'contact.create', data, `Voy a guardar el contacto ${intent.name}${intent.phone ? ` (${intent.phone})` : ''} en ${where}.`);
    }

    case 'query':
      return answer(ctx, intent.topic, intent.term);
  }
}

/** Respuestas de consulta: cada servicio vuelve a comprobar el permiso de lectura. */
export async function answer(ctx: Ctx, topic: Extract<Intent, { type: 'query' }>['topic'], term?: string): Promise<Reply> {
  const tz = ctx.space.timezone;
  try {
    switch (topic) {
      case 'today': {
        const today = todayIn(tz);
        const { tasks: t, reminders: r } = await tasks.getDailyAgenda(ctx, today);
        const lines = [
          ...r.map((x) => `⏰ ${DateTime.fromJSDate(x.at, { zone: tz }).toFormat('HH:mm')} ${x.title}`),
          ...t.map((x) => `${x.dueDate && x.dueDate < today ? '⚠️ (atrasada)' : '☐'} ${x.title}${x.dueTime ? ` · ${x.dueTime}` : ''}`),
        ];
        if (can(ctx.role, 'finance.read')) {
          const bills = await finance.getUpcomingObligations(ctx, DateTime.fromISO(`${today}T23:59`, { zone: tz }).toJSDate());
          lines.push(...bills.map((b) => `💸 ${b.direction === 'payable' ? 'Pagar' : 'Cobrar'}: ${b.title} ${formatMoney(b.amount - b.paid, b.currency)}`));
        }
        return { text: lines.length ? `Tu día (${fmtDay(today, tz)}):\n${lines.join('\n')}` : 'No tienes pendientes para hoy. 🎉' };
      }
      case 'pending': {
        const list = await tasks.listOpenTasks(ctx);
        return { text: list.length ? `Pendientes:\n${list.map((x) => `☐ ${x.title}${x.dueDate ? ` · ${fmtDay(x.dueDate, tz)}` : ''}`).join('\n')}` : 'No tienes tareas pendientes.' };
      }
      case 'spending':
      case 'budget': {
        const s = await finance.getFinancialSummary(ctx, {});
        if (topic === 'budget') {
          if (!s.budgets.length) return { text: 'No tienes presupuestos configurados. Créalos en la app → Finanzas.' };
          return { text: `Presupuestos de ${s.month}:\n${s.budgets.map((b) => `${categoryLabel('expense', b.category)}: ${formatMoney(b.spent, b.currency)} de ${formatMoney(b.limit, b.currency)} (${Math.round((b.spent / b.limit) * 100)}%)`).join('\n')}` };
        }
        const cur = Object.entries(s.totals);
        if (!cur.length) return { text: 'No hay movimientos registrados este mes.' };
        return {
          text: cur.map(([c, t]) => {
            const top = Object.entries(s.byCategory[c] ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3)
              .map(([k, v]) => `  · ${categoryLabel('expense', k)}: ${formatMoney(v, c as Currency)}`).join('\n');
            return `Este mes (${c}): gastos ${formatMoney(t.expense, c as Currency)}, ingresos ${formatMoney(t.income, c as Currency)}.${top ? `\n${top}` : ''}`;
          }).join('\n') + (s.truncated ? '\n(Resumen parcial: demasiados movimientos.)' : ''),
        };
      }
      case 'balance': {
        const acc = await finance.getBalances(ctx);
        if (!acc.length) return { text: 'No tienes cuentas registradas. Créalas en la app → Finanzas → Cuentas.' };
        const totals: Record<string, number> = {};
        for (const a of acc) totals[a.currency] = (totals[a.currency] ?? 0) + a.balance;
        return {
          text: `Saldos calculados con lo registrado en la app (no consultan tu banco):\n${acc.map((a) => `• ${a.name}: ${formatMoney(a.balance, a.currency)}`).join('\n')}\n` +
            Object.entries(totals).map(([c, v]) => `Total ${c}: ${formatMoney(v, c as Currency)}`).join('\n'),
        };
      }
      case 'bills': {
        const until = nowIn(tz).plus({ days: 7 }).endOf('day').toJSDate();
        const list = await finance.getUpcomingObligations(ctx, until);
        if (!list.length) return { text: 'No tienes pagos ni cobros que venzan en los próximos 7 días.' };
        return { text: `Próximos 7 días:\n${list.map((b) => `${b.direction === 'payable' ? '💸 Pagar' : '💰 Cobrar'} ${b.title}: ${formatMoney(b.amount - b.paid, b.currency)} · ${b.dueDate ? fmtDay(b.dueDate, tz) : ''}`).join('\n')}` };
      }
      case 'contacts': {
        const found = term ? await searchContacts(ctx, term, 5) : [];
        if (!found.length) return { text: `No encontré contactos${term ? ` para «${term}»` : ''}.` };
        return { text: found.map((c) => `👤 ${c.name}${c.company ? ` · ${c.company}` : ''}\n${[...c.phones, ...c.emails].join(' · ')}`).join('\n\n') };
      }
    }
  } catch (err) {
    if (err instanceof DomainError) return { text: err.message };
    throw err;
  }
}

function callerOf(ctx: Ctx & { caller?: Caller }): Caller {
  return ctx.caller ?? { uid: ctx.uid, email: null, name: null, source: ctx.source };
}

/** Une la respuesta a una pregunta pendiente ("¿a qué hora?") con la intención original. */
function complete(aw: Awaiting, text: string, ic: InterpretContext): Intent | null {
  if (aw.field === 'when') {
    const { when } = extractWhen(text, DateTime.fromISO(ic.now, { setZone: true }));
    if (!when.date && !when.time) return null;
    const i = aw.intent as Extract<Intent, { type: 'reminder' }>;
    return { ...i, date: when.date ?? i.date, time: when.time ?? i.time, recurrence: when.recurrence ?? i.recurrence };
  }
  const m = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/.exec(text);
  const cur = ((aw.intent as { currency?: Currency }).currency ?? ic.currency) as Currency;
  const amount = m ? parseAmount(m[1]!, cur) : null;
  return amount ? ({ ...aw.intent, amount, currency: cur } as Intent) : null;
}

async function message(ctx: Ctx, input: OpData<'assistant.message'>, caller: Caller): Promise<Reply> {
  const key = caller.convKey ?? `pwa_${caller.uid}`;
  const c = { ...ctx, caller };
  const conv = (await convRef(key).get()).data() as Conversation | undefined;
  const ic = ictx(ctx);
  try {
    const aw = conv?.awaiting;
    if (aw && aw.spaceId === ctx.spaceId && aw.expiresAt.toMillis() > Date.now()) {
      const done = complete(aw, input.text, ic);
      if (done) return await plan(key, c, done);
    }
    const intent = await interpret(input.text, ic);
    return await plan(key, c, intent);
  } catch (err) {
    if (err instanceof DomainError) return { text: `No se pudo completar: ${err.message}` };
    throw err;
  }
}

async function confirm(ctx: Ctx, input: OpData<'assistant.confirm'>, caller: Caller): Promise<Reply> {
  const ref = convRef(caller.convKey ?? `pwa_${caller.uid}`);
  // Se consume en una transacción: un doble toque no ejecuta dos veces (y el requestId también lo impide).
  const pending = await db.runTransaction(async (tx) => {
    const conv = (await tx.get(ref)).data() as Conversation | undefined;
    const p = conv?.pending;
    if (!p || p.id !== input.actionId || conv!.uid !== caller.uid || p.spaceId !== ctx.spaceId || p.expiresAt.toMillis() < Date.now()) return null;
    tx.update(ref, { pending: null });
    return p;
  });
  if (!pending) return { text: 'Esta confirmación ya no es válida (expiró o ya se usó). Vuelve a enviarme la solicitud.' };
  if (!input.accept) return { text: 'Cancelado. No se guardó nada.' };
  const choice = pending.choices[input.choice ?? 0];
  if (!choice) return { text: 'Opción no válida.' };
  try {
    const result = (await runOp(caller, pending.op, pending.spaceId, { ...pending.data, ...choice.patch })) as Record<string, unknown>;
    return { text: await doneText(ctx, pending, result) };
  } catch (err) {
    if (err instanceof DomainError) return { text: `No se guardó: ${err.message}` };
    throw err;
  }
}

async function doneText(ctx: Ctx, p: Pending, result: Record<string, unknown>) {
  if (result.duplicate) return 'Esto ya estaba registrado; no se duplicó.';
  if (p.op === 'tx.record') {
    const d = p.data as OpData<'tx.record'>;
    let text = `✅ ${d.kind === 'expense' ? 'Gasto' : 'Ingreso'} registrado: ${formatMoney(d.amount, d.currency)}.`;
    if (d.kind === 'expense') {
      const s = await finance.getFinancialSummary(ctx, {});
      const b = s.budgets.find((x) => x.category === d.category && x.currency === d.currency);
      if (b && b.spent >= b.limit * 0.8) text += `\n⚠️ Llevas ${Math.round((b.spent / b.limit) * 100)}% del presupuesto de ${categoryLabel('expense', b.category)}.`;
    }
    return text;
  }
  if (p.op === 'obligation.create') return `✅ Registrado${result.reminderId ? ' con recordatorio' : ''}.`;
  if (p.op === 'contact.create') {
    const dups = (result.possibleDuplicates as string[] | undefined)?.length;
    return `✅ Contacto guardado.${dups ? ' Ojo: hay otro contacto con el mismo teléfono o correo; revísalo en la app.' : ''}`;
  }
  if (p.op === 'obligation.pay') return `✅ Pago registrado. Estado: ${{ settled: 'liquidada', partial: 'pago parcial', open: 'pendiente' }[result.status as string] ?? result.status}.`;
  return '✅ Listo.';
}

/** Propuesta directa desde un comando o un contacto compartido (sin pasar por el intérprete). */
export async function proposeFrom(ctx: Ctx, caller: Caller, intent: Intent): Promise<Reply> {
  return plan(caller.convKey ?? `pwa_${caller.uid}`, { ...ctx, caller } as Ctx, intent);
}

/** Pago total de una obligación propuesto desde /pago. */
export async function proposePayment(ctx: Ctx, caller: Caller, obligationId: string): Promise<Reply> {
  const o = (await db.doc(`spaces/${ctx.spaceId}/obligations/${obligationId}`).get()).data();
  if (!o || !['open', 'partial'].includes(o.status)) return { text: 'Esa obligación ya no está pendiente.' };
  const remaining = (o.amount as number) - (o.paid as number);
  const acc = await accountChoices(ctx, o.currency as Currency);
  return propose(caller.convKey!, { ...ctx, caller } as Ctx, 'obligation.pay',
    { obligationId, amount: remaining, date: todayIn(ctx.space.timezone), accountId: acc.accountId },
    `Voy a registrar el ${o.direction === 'payable' ? 'pago' : 'cobro'} de ${formatMoney(remaining, o.currency as Currency)} por «${o.title}»${acc.label ? ` (cuenta ${acc.label})` : ''}, con fecha de hoy.`,
    acc.choices);
}

assistantHandlers['assistant.message'] = message;
assistantHandlers['assistant.confirm'] = confirm;
