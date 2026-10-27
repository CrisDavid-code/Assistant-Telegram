import { DateTime } from 'luxon';
import type { AccountDoc, BudgetDoc, Currency, FinanceSummary, ObligationDoc, OpData, TransactionDoc } from '@lifeos/contracts';
import { db, FieldValue, Timestamp, type Tx } from '../shared/firebase';
import { fail } from '../shared/errors';
import { audit } from '../shared/audit';
import { monthRange, nowIn, zoned } from '../shared/time';
import { requirePerm, type Ctx } from '../auth/context';
import { createReminderTx } from '../reminders/service';

// Reglas: importes enteros en unidades menores, moneda en cada registro, saldos de cuenta actualizados en la
// misma transacción que el movimiento, anulación en vez de borrado, y nunca sumar monedas distintas.

const ref = (ctx: Ctx, col: string, id: string) => db.doc(`spaces/${ctx.spaceId}/${col}/${id}`);
/** Fecha sin hora → mediodía local: no cambia de día al convertir a UTC. */
const occurredAt = (ctx: Ctx, date: string) => Timestamp.fromDate(zoned(date, '12:00', ctx.space.timezone));

async function getAccount(tx: Tx, ctx: Ctx, id: string) {
  const a = (await tx.get(ref(ctx, 'accounts', id))).data() as AccountDoc | undefined;
  if (!a) fail('not-found', 'La cuenta no existe en este espacio.');
  if (a!.archived) fail('failed-precondition', `La cuenta "${a!.name}" está archivada.`);
  return a!;
}

function checkFutureDate(ctx: Ctx, date: string) {
  // Se permite registrar hasta mañana (diferencias de zona); el futuro lejano suele ser un error de dedo.
  if (date > nowIn(ctx.space.timezone).plus({ days: 1 }).toISODate()!) fail('invalid-argument', 'La fecha del movimiento está en el futuro.');
}

export async function createAccount(ctx: Ctx, input: OpData<'account.create'>) {
  requirePerm(ctx, 'finance.write');
  const r = ref(ctx, 'accounts', input.requestId);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(r)).exists) return { accountId: r.id, duplicate: true };
    tx.create(r, {
      name: input.name, type: input.type, currency: input.currency,
      openingBalance: input.openingBalance, balance: input.openingBalance, archived: false,
      createdBy: ctx.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    audit(tx, ctx, 'account.create', r.path, { currency: input.currency, openingBalance: input.openingBalance });
    return { accountId: r.id, duplicate: false };
  });
}

export async function updateAccount(ctx: Ctx, input: OpData<'account.update'>) {
  requirePerm(ctx, 'finance.write');
  const r = ref(ctx, 'accounts', input.accountId);
  await db.runTransaction(async (tx) => {
    if (!(await tx.get(r)).exists) fail('not-found', 'Cuenta no encontrada.');
    const patch = Object.fromEntries(Object.entries({ name: input.name, archived: input.archived }).filter(([, v]) => v !== undefined));
    tx.update(r, { ...patch, updatedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, 'account.update', r.path, patch);
  });
  return { ok: true };
}

type TxBase = Omit<TransactionDoc, 'createdAt' | 'occurredAt' | 'voidedAt'>;
function writeTx(tx: Tx, ctx: Ctx, id: string, t: Omit<TxBase, 'status' | 'voidReason' | 'createdBy' | 'source'>) {
  const r = ref(ctx, 'transactions', id);
  tx.create(r, {
    ...t, status: 'posted', voidReason: null, voidedAt: null, createdBy: ctx.uid, source: ctx.source,
    occurredAt: occurredAt(ctx, t.date), createdAt: FieldValue.serverTimestamp(),
  });
  return r;
}

export async function recordTransaction(ctx: Ctx, input: OpData<'tx.record'>) {
  requirePerm(ctx, 'finance.write');
  checkFutureDate(ctx, input.date);
  const r = ref(ctx, 'transactions', input.requestId);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(r)).exists) return { txId: r.id, duplicate: true };
    if (input.accountId) {
      const acc = await getAccount(tx, ctx, input.accountId);
      if (acc.currency !== input.currency) fail('invalid-argument', `La cuenta "${acc.name}" es en ${acc.currency}; el movimiento es en ${input.currency}.`);
      tx.update(ref(ctx, 'accounts', input.accountId), {
        balance: FieldValue.increment(input.kind === 'income' ? input.amount : -input.amount), updatedAt: FieldValue.serverTimestamp(),
      });
    }
    writeTx(tx, ctx, r.id, {
      kind: input.kind, amount: input.amount, currency: input.currency, accountId: input.accountId ?? null,
      toAccountId: null, toAmount: null, toCurrency: null, category: input.category,
      description: input.description ?? null, date: input.date, obligationId: null,
    });
    audit(tx, ctx, `tx.${input.kind}`, r.path, { amount: input.amount, currency: input.currency });
    return { txId: r.id, duplicate: false };
  });
}

/** Transferencia entre cuentas propias: un solo documento, no es ingreso ni gasto. */
export async function recordTransfer(ctx: Ctx, input: OpData<'tx.transfer'>) {
  requirePerm(ctx, 'finance.write');
  if (input.fromAccountId === input.toAccountId) fail('invalid-argument', 'Elige dos cuentas distintas.');
  checkFutureDate(ctx, input.date);
  const r = ref(ctx, 'transactions', input.requestId);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(r)).exists) return { txId: r.id, duplicate: true };
    const [from, to] = await Promise.all([getAccount(tx, ctx, input.fromAccountId), getAccount(tx, ctx, input.toAccountId)]);
    if (from.currency !== to.currency && !input.toAmount) fail('invalid-argument', `Las cuentas tienen monedas distintas (${from.currency} → ${to.currency}): indica el monto recibido.`);
    const toAmount = from.currency === to.currency ? input.amount : input.toAmount!;
    if (from.currency === to.currency && input.toAmount && input.toAmount !== input.amount) fail('invalid-argument', 'En la misma moneda el monto recibido debe ser igual al enviado.');
    tx.update(ref(ctx, 'accounts', input.fromAccountId), { balance: FieldValue.increment(-input.amount), updatedAt: FieldValue.serverTimestamp() });
    tx.update(ref(ctx, 'accounts', input.toAccountId), { balance: FieldValue.increment(toAmount), updatedAt: FieldValue.serverTimestamp() });
    writeTx(tx, ctx, r.id, {
      kind: 'transfer', amount: input.amount, currency: from.currency, accountId: input.fromAccountId,
      toAccountId: input.toAccountId, toAmount, toCurrency: to.currency, category: 'transferencia',
      description: input.description ?? null, date: input.date, obligationId: null,
    });
    audit(tx, ctx, 'tx.transfer', r.path, { amount: input.amount, toAmount, from: from.currency, to: to.currency });
    return { txId: r.id, duplicate: false };
  });
}

const obligationStatus = (o: Pick<ObligationDoc, 'paid' | 'amount'>): ObligationDoc['status'] =>
  o.paid <= 0 ? 'open' : o.paid >= o.amount ? 'settled' : 'partial';

/** Anulación auditable: revierte saldos y pagos de obligaciones. El registro queda, marcado "voided". */
export async function voidTransaction(ctx: Ctx, input: OpData<'tx.void'>) {
  requirePerm(ctx, 'finance.write');
  const r = ref(ctx, 'transactions', input.txId);
  await db.runTransaction(async (tx) => {
    const t = (await tx.get(r)).data() as TransactionDoc | undefined;
    if (!t) fail('not-found', 'Movimiento no encontrado.');
    if (t!.status === 'voided') fail('failed-precondition', 'El movimiento ya estaba anulado.');
    const oRef = t!.obligationId ? ref(ctx, 'obligations', t!.obligationId) : null;
    const o = oRef ? ((await tx.get(oRef)).data() as ObligationDoc | undefined) : undefined;
    // Las cuentas archivadas también se corrigen: el saldo debe cuadrar con los registros.
    if (t!.kind === 'transfer') {
      tx.update(ref(ctx, 'accounts', t!.accountId!), { balance: FieldValue.increment(t!.amount) });
      tx.update(ref(ctx, 'accounts', t!.toAccountId!), { balance: FieldValue.increment(-t!.toAmount!) });
    } else if (t!.accountId) {
      tx.update(ref(ctx, 'accounts', t!.accountId), { balance: FieldValue.increment(t!.kind === 'income' ? -t!.amount : t!.amount) });
    }
    if (oRef && o) {
      const paid = o.paid - t!.amount;
      tx.update(oRef, { paid, status: o.status === 'cancelled' ? 'cancelled' : obligationStatus({ paid, amount: o.amount }), updatedAt: FieldValue.serverTimestamp() });
    }
    tx.update(r, { status: 'voided', voidReason: input.reason, voidedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, 'tx.void', r.path, { reason: input.reason, amount: t!.amount, currency: t!.currency });
  });
  return { ok: true };
}

export async function createObligation(ctx: Ctx, input: OpData<'obligation.create'>) {
  requirePerm(ctx, 'finance.write');
  const r = ref(ctx, 'obligations', input.requestId);
  const tz = ctx.space.timezone;
  const dueAt = input.dueDate ? Timestamp.fromDate(zoned(input.dueDate, '23:59', tz)) : null;
  let remindAt: Timestamp | null = null;
  if (input.dueDate && input.remindDaysBefore !== undefined) {
    const at = DateTime.fromISO(`${input.dueDate}T08:00`, { zone: tz }).minus({ days: input.remindDaysBefore });
    if (at.toMillis() > Date.now()) remindAt = Timestamp.fromDate(at.toJSDate());
  }
  return db.runTransaction(async (tx) => {
    if ((await tx.get(r)).exists) return { obligationId: r.id, duplicate: true, reminderId: null };
    if (input.contactId && !(await tx.get(ref(ctx, 'contacts', input.contactId))).exists) fail('invalid-argument', 'El contacto no existe en este espacio.');
    const verb = input.direction === 'payable' ? 'Pagar' : 'Cobrar';
    const reminder = remindAt ? createReminderTx(tx, ctx, `${r.id}_r`, { title: `${verb}: ${input.title}`, when: remindAt, obligationId: r.id }) : null;
    tx.create(r, {
      direction: input.direction, kind: input.kind, title: input.title, counterparty: input.counterparty ?? null,
      contactId: input.contactId ?? null, amount: input.amount, paid: 0, currency: input.currency,
      dueDate: input.dueDate ?? null, dueAt, status: 'open', reminderId: reminder?.id ?? null,
      createdBy: ctx.uid, source: ctx.source, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    audit(tx, ctx, 'obligation.create', r.path, { direction: input.direction, amount: input.amount, currency: input.currency });
    return { obligationId: r.id, duplicate: false, reminderId: reminder?.id ?? null };
  });
}

/**
 * Registrar un pago (total o parcial) de una obligación: crea el movimiento (gasto si se debe, ingreso si
 * se cobra) y actualiza lo pagado en la misma transacción, así nunca se cuenta dos veces.
 */
export async function payObligation(ctx: Ctx, input: OpData<'obligation.pay'>) {
  requirePerm(ctx, 'finance.write');
  checkFutureDate(ctx, input.date);
  const oRef = ref(ctx, 'obligations', input.obligationId);
  const tRef = ref(ctx, 'transactions', input.requestId);
  return db.runTransaction(async (tx) => {
    const [dup, oSnap] = await Promise.all([tx.get(tRef), tx.get(oRef)]);
    if (dup.exists) return { txId: tRef.id, duplicate: true, status: oSnap.get('status') as string };
    const o = oSnap.data() as ObligationDoc | undefined;
    if (!o) fail('not-found', 'Obligación no encontrada.');
    if (o!.status === 'settled' || o!.status === 'cancelled') fail('failed-precondition', 'Esta obligación ya está liquidada o cancelada.');
    const remaining = o!.amount - o!.paid;
    if (input.amount > remaining) fail('invalid-argument', `El pago excede el saldo pendiente.`);
    const kind = o!.direction === 'payable' ? 'expense' : 'income';
    if (input.accountId) {
      const acc = await getAccount(tx, ctx, input.accountId);
      if (acc.currency !== o!.currency) fail('invalid-argument', `La cuenta "${acc.name}" es en ${acc.currency}; la obligación es en ${o!.currency}.`);
      tx.update(ref(ctx, 'accounts', input.accountId), { balance: FieldValue.increment(kind === 'income' ? input.amount : -input.amount), updatedAt: FieldValue.serverTimestamp() });
    }
    const paid = o!.paid + input.amount;
    const status = obligationStatus({ paid, amount: o!.amount });
    writeTx(tx, ctx, tRef.id, {
      kind, amount: input.amount, currency: o!.currency, accountId: input.accountId ?? null,
      toAccountId: null, toAmount: null, toCurrency: null,
      category: kind === 'income' ? 'cobros' : o!.kind === 'subscription' ? 'suscripciones' : o!.kind === 'bill' ? 'servicios' : 'otros',
      description: o!.title, date: input.date, obligationId: oRef.id,
    });
    tx.update(oRef, { paid, status, updatedAt: FieldValue.serverTimestamp() });
    // Liquidada: el recordatorio de cobro/pago ya no tiene sentido.
    if (status === 'settled' && o!.reminderId) {
      tx.update(ref(ctx, 'reminders', o!.reminderId), { status: 'cancelled', version: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
    }
    audit(tx, ctx, 'obligation.pay', oRef.path, { amount: input.amount, paid, status });
    return { txId: tRef.id, duplicate: false, status };
  });
}

export async function cancelObligation(ctx: Ctx, input: OpData<'obligation.cancel'>) {
  requirePerm(ctx, 'finance.write');
  const oRef = ref(ctx, 'obligations', input.obligationId);
  await db.runTransaction(async (tx) => {
    const o = (await tx.get(oRef)).data() as ObligationDoc | undefined;
    if (!o) fail('not-found', 'Obligación no encontrada.');
    if (o!.status === 'settled') fail('failed-precondition', 'Ya está liquidada.');
    tx.update(oRef, { status: 'cancelled', updatedAt: FieldValue.serverTimestamp() });
    if (o!.reminderId) tx.update(ref(ctx, 'reminders', o!.reminderId), { status: 'cancelled', version: FieldValue.increment(1) });
    audit(tx, ctx, 'obligation.cancel', oRef.path);
  });
  return { ok: true };
}

const budgetId = (category: string) => encodeURIComponent(category).replace(/[.%]/g, '_');

export async function setBudget(ctx: Ctx, input: OpData<'budget.set'>) {
  requirePerm(ctx, 'finance.write');
  await db.runTransaction(async (tx) => {
    const r = ref(ctx, 'budgets', budgetId(input.category));
    tx.set(r, { category: input.category, limit: input.limit, currency: input.currency, updatedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, 'budget.set', r.path, { limit: input.limit, currency: input.currency });
  });
  return { ok: true };
}

export async function removeBudget(ctx: Ctx, input: OpData<'budget.remove'>) {
  requirePerm(ctx, 'finance.write');
  await db.runTransaction(async (tx) => {
    const r = ref(ctx, 'budgets', budgetId(input.category));
    tx.delete(r);
    audit(tx, ctx, 'budget.remove', r.path);
  });
  return { ok: true };
}

export const MAX_SUMMARY_TX = 5000;

/** Resumen del mes local: totales por moneda (sin mezclar), gasto por categoría y avance de presupuestos. */
export async function getFinancialSummary(ctx: Ctx, input: OpData<'finance.summary'>): Promise<FinanceSummary> {
  requirePerm(ctx, 'finance.read');
  const month = input.month ?? nowIn(ctx.space.timezone).toFormat('yyyy-MM');
  const [start, end] = monthRange(month, ctx.space.timezone);
  // ponytail: suma en memoria hasta 5000 movimientos/mes; resúmenes mensuales materializados si se supera.
  const [txs, budgets] = await Promise.all([
    db.collection(`spaces/${ctx.spaceId}/transactions`).where('occurredAt', '>=', Timestamp.fromDate(start))
      .where('occurredAt', '<', Timestamp.fromDate(end)).orderBy('occurredAt').limit(MAX_SUMMARY_TX).get(),
    db.collection(`spaces/${ctx.spaceId}/budgets`).get(),
  ]);
  const totals: FinanceSummary['totals'] = {};
  const byCategory: FinanceSummary['byCategory'] = {};
  for (const d of txs.docs) {
    const t = d.data() as TransactionDoc;
    if (t.status !== 'posted' || t.kind === 'transfer') continue;
    const tot = (totals[t.currency] ??= { income: 0, expense: 0 });
    tot[t.kind] += t.amount;
    if (t.kind === 'expense') {
      const cat = (byCategory[t.currency] ??= {});
      cat[t.category] = (cat[t.category] ?? 0) + t.amount;
    }
  }
  return {
    month, totals, byCategory, truncated: txs.size === MAX_SUMMARY_TX,
    budgets: budgets.docs.map((b) => {
      const x = b.data() as BudgetDoc;
      return { category: x.category, currency: x.currency as Currency, limit: x.limit, spent: byCategory[x.currency]?.[x.category] ?? 0 };
    }),
  };
}

/** Saldos calculados por cuenta activa (lo que la app registró, no el banco). */
export async function getBalances(ctx: Ctx) {
  requirePerm(ctx, 'finance.read');
  const snap = await db.collection(`spaces/${ctx.spaceId}/accounts`).where('archived', '==', false).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as AccountDoc) }));
}

/** Obligaciones abiertas que vencen hasta `until` (incluye vencidas). */
export async function getUpcomingObligations(ctx: Ctx, until: Date) {
  requirePerm(ctx, 'finance.read');
  const snap = await db.collection(`spaces/${ctx.spaceId}/obligations`).where('status', 'in', ['open', 'partial'])
    .where('dueAt', '<=', Timestamp.fromDate(until)).orderBy('dueAt').limit(30).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as ObligationDoc) }));
}

/** Recalcula el saldo de una cuenta desde los registros (conciliación; ver docs/runbooks.md). */
export async function recomputeBalance(ctx: Ctx, accountId: string) {
  requirePerm(ctx, 'finance.read');
  const acc = (await ref(ctx, 'accounts', accountId).get()).data() as AccountDoc | undefined;
  if (!acc) fail('not-found', 'Cuenta no encontrada.');
  const col = db.collection(`spaces/${ctx.spaceId}/transactions`);
  const [out, inc] = await Promise.all([col.where('accountId', '==', accountId).get(), col.where('toAccountId', '==', accountId).get()]);
  let balance = acc!.openingBalance;
  for (const d of out.docs) {
    const t = d.data() as TransactionDoc;
    if (t.status === 'posted') balance += t.kind === 'income' ? t.amount : -t.amount;
  }
  for (const d of inc.docs) {
    const t = d.data() as TransactionDoc;
    if (t.status === 'posted') balance += t.toAmount!;
  }
  return { stored: acc!.balance, computed: balance, matches: balance === acc!.balance };
}
