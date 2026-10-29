import type { OpData, OpportunityDoc } from '@lifeos/contracts';
import { can } from '@lifeos/contracts';
import { db, FieldValue, Timestamp } from '../shared/firebase';
import { zoned } from '../shared/time';
import { fail } from '../shared/errors';
import { audit } from '../shared/audit';
import { requirePerm, type Ctx } from '../auth/context';

// Oportunidades de venta. Una venta ganada NO es dinero recibido: opcionalmente crea un cobro esperado
// (obligación "por cobrar") en la misma transacción; el ingreso se registra al cobrarlo.

const ref = (ctx: Ctx, id: string) => db.doc(`spaces/${ctx.spaceId}/opportunities/${id}`);

export async function createOpportunity(ctx: Ctx, input: OpData<'opportunity.create'>) {
  requirePerm(ctx, 'core.write');
  if (input.amount && !input.currency) fail('invalid-argument', 'Indica la moneda del monto.');
  const r = ref(ctx, input.requestId);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(r)).exists) return { opportunityId: r.id, duplicate: true };
    if (input.contactId && !(await tx.get(db.doc(`spaces/${ctx.spaceId}/contacts/${input.contactId}`))).exists) fail('invalid-argument', 'El contacto no existe en este espacio.');
    tx.create(r, {
      title: input.title, contactId: input.contactId ?? null, stage: 'lead', amount: input.amount ?? null, currency: input.currency ?? null,
      expectedClose: input.expectedClose ?? null, nextAction: input.nextAction ?? null, notes: input.notes ?? null,
      obligationId: null, closedAt: null, createdBy: ctx.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    audit(tx, ctx, 'opportunity.create', r.path);
    return { opportunityId: r.id, duplicate: false };
  });
}

export async function updateOpportunity(ctx: Ctx, input: OpData<'opportunity.update'>) {
  requirePerm(ctx, 'core.write');
  const r = ref(ctx, input.opportunityId);
  const { opportunityId: _, ...rest } = input;
  const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  await db.runTransaction(async (tx) => {
    if (!(await tx.get(r)).exists) fail('not-found', 'Oportunidad no encontrada.');
    tx.update(r, { ...patch, updatedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, 'opportunity.update', r.path, { fields: Object.keys(patch) });
  });
  return { ok: true };
}

export async function setOpportunityStage(ctx: Ctx, input: OpData<'opportunity.setStage'>) {
  requirePerm(ctx, 'core.write');
  if (input.createReceivable && !can(ctx.role, 'finance.write')) fail('permission-denied', 'Tu rol no permite registrar cobros.');
  const r = ref(ctx, input.opportunityId);
  return db.runTransaction(async (tx) => {
    const o = (await tx.get(r)).data() as OpportunityDoc | undefined;
    if (!o) fail('not-found', 'Oportunidad no encontrada.');
    let obligationId = o!.obligationId;
    if (input.stage === 'won' && input.createReceivable && !obligationId) {
      if (!o!.amount || !o!.currency) fail('invalid-argument', 'Indica el monto de la oportunidad para registrar el cobro.');
      const oRef = db.doc(`spaces/${ctx.spaceId}/obligations/opp_${r.id}`);
      tx.create(oRef, {
        direction: 'receivable', kind: 'expected', title: o!.title, counterparty: null, contactId: o!.contactId,
        amount: o!.amount, paid: 0, currency: o!.currency, dueDate: o!.expectedClose,
        dueAt: o!.expectedClose ? Timestamp.fromDate(zoned(o!.expectedClose, '23:59', ctx.space.timezone)) : null, status: 'open', reminderId: null,
        createdBy: ctx.uid, source: ctx.source, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      obligationId = oRef.id;
    }
    const closed = input.stage === 'won' || input.stage === 'lost';
    tx.update(r, { stage: input.stage, obligationId, closedAt: closed ? FieldValue.serverTimestamp() : null, updatedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, 'opportunity.setStage', r.path, { stage: input.stage, obligationId });
    return { ok: true, obligationId };
  });
}
