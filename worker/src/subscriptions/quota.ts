import { METERED_OPS, PLANS } from '@lifeos/contracts';
import { db, FieldValue } from '../shared/firebase';
import { fail } from '../shared/errors';
import { nowIn } from '../shared/time';
import type { Ctx } from '../auth/context';

/** Cuenta y limita el uso mensual por espacio. Se aplica en el backend antes de ejecutar la operación. */
export async function checkQuota(ctx: Ctx, op: string) {
  const metric = METERED_OPS[op];
  if (!metric) return;
  const limit = PLANS[ctx.space.plan]?.[metric] ?? PLANS.free[metric];
  const ref = db.doc(`spaces/${ctx.spaceId}/usage/${nowIn(ctx.space.timezone).toFormat('yyyy-MM')}`);
  await db.runTransaction(async (tx) => {
    const used = ((await tx.get(ref)).get(metric) as number | undefined) ?? 0;
    if (used >= limit) fail('resource-exhausted', `Alcanzaste el límite mensual de tu plan (${limit} mensajes al asistente).`);
    tx.set(ref, { [metric]: FieldValue.increment(1), month: ref.id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
