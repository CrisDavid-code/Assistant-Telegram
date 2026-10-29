import type { GoalDoc, OpData } from '@lifeos/contracts';
import { db, FieldValue } from '../shared/firebase';
import { fail } from '../shared/errors';
import { audit } from '../shared/audit';
import { requirePerm, type Ctx } from '../auth/context';

// Metas de ahorro: un "apartado" con historial de aportes. No mueve saldos de cuentas (el dinero sigue
// en la cuenta donde esté); así no se duplica ni se descuadra la contabilidad de movimientos.

const ref = (ctx: Ctx, id: string) => db.doc(`spaces/${ctx.spaceId}/goals/${id}`);

export async function createGoal(ctx: Ctx, input: OpData<'goal.create'>) {
  requirePerm(ctx, 'finance.write');
  const r = ref(ctx, input.requestId);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(r)).exists) return { goalId: r.id, duplicate: true };
    tx.create(r, {
      name: input.name, target: input.target, saved: 0, currency: input.currency, targetDate: input.targetDate ?? null,
      status: 'active', createdBy: ctx.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    audit(tx, ctx, 'goal.create', r.path, { target: input.target, currency: input.currency });
    return { goalId: r.id, duplicate: false };
  });
}

export async function contributeGoal(ctx: Ctx, input: OpData<'goal.contribute'>) {
  requirePerm(ctx, 'finance.write');
  const r = ref(ctx, input.goalId);
  const c = db.doc(`spaces/${ctx.spaceId}/goalContributions/${input.requestId}`);
  return db.runTransaction(async (tx) => {
    const [g, dup] = await Promise.all([tx.get(r), tx.get(c)]);
    const goal = g.data() as GoalDoc | undefined;
    if (dup.exists) return { saved: goal?.saved ?? 0, duplicate: true };
    if (!goal) fail('not-found', 'Meta no encontrada.');
    if (goal!.status === 'archived') fail('failed-precondition', 'La meta está archivada.');
    const saved = goal!.saved + input.amount;
    if (saved < 0) fail('invalid-argument', 'No puedes retirar más de lo ahorrado.');
    tx.create(c, { goalId: r.id, amount: input.amount, note: input.note ?? null, createdBy: ctx.uid, createdAt: FieldValue.serverTimestamp() });
    tx.update(r, { saved, status: saved >= goal!.target ? 'reached' : 'active', updatedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, 'goal.contribute', r.path, { amount: input.amount, saved });
    return { saved, reached: saved >= goal!.target, duplicate: false };
  });
}

export async function archiveGoal(ctx: Ctx, input: OpData<'goal.archive'>) {
  requirePerm(ctx, 'finance.write');
  const r = ref(ctx, input.goalId);
  await db.runTransaction(async (tx) => {
    if (!(await tx.get(r)).exists) fail('not-found', 'Meta no encontrada.');
    tx.update(r, { status: 'archived', updatedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, 'goal.archive', r.path);
  });
  return { ok: true };
}
