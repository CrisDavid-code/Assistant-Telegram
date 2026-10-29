import { PLANS, type PlanId } from '@lifeos/contracts';
import { db, FieldValue, Timestamp } from '../shared/firebase';
import { fail } from '../shared/errors';
import { nowIn } from '../shared/time';
import { requirePerm, type Ctx } from '../auth/context';
import { telegram } from '../telegram/api';
import { logger } from '../shared/log';

/** Administradores de la plataforma: lista de uid en la variable ADMIN_UIDS (no hay claims ni Admin SDK). */
export const isPlatformAdmin = (uid: string) => (process.env.ADMIN_UIDS ?? '').split(',').map((s) => s.trim()).filter(Boolean).includes(uid);
const requireAdmin = (uid: string) => {
  if (!isPlatformAdmin(uid)) fail('permission-denied', 'Solo para administradores de la plataforma.');
};

const month = () => nowIn('America/Guatemala').toFormat('yyyy-MM');

/** Uso del plan del espacio en el mes. */
export async function getUsage(ctx: Ctx) {
  requirePerm(ctx, 'core.read');
  const m = nowIn(ctx.space.timezone).toFormat('yyyy-MM');
  const u = (await db.doc(`spaces/${ctx.spaceId}/usage/${m}`).get()).data() ?? {};
  const plan = PLANS[ctx.space.plan as PlanId] ?? PLANS.free;
  return {
    month: m, plan: ctx.space.plan, planLabel: plan.label,
    assistant: { used: (u.assistantPerMonth as number) ?? 0, limit: plan.assistantPerMonth },
    aiTokens: { input: (u.aiInputTokens as number) ?? 0, output: (u.aiOutputTokens as number) ?? 0 },
  };
}

/** Métricas de la plataforma con conteos en el servidor (no lee documentos). */
export async function adminStats(uid: string) {
  requireAdmin(uid);
  const g = (c: string) => db.collectionGroup(c);
  const [users, spaces, business, telegramLinks, failed, undeliverable, scheduled, usage] = await Promise.all([
    db.collection('users').aggregate(),
    db.collection('spaces').aggregate(),
    db.collection('spaces').where('type', '==', 'business').aggregate(),
    db.collection('telegramLinks').aggregate(),
    g('reminders').where('status', '==', 'failed').aggregate(),
    g('reminders').where('status', '==', 'undeliverable').aggregate(),
    g('reminders').where('status', '==', 'scheduled').aggregate(),
    g('usage').where('month', '==', month()).aggregate(['assistantPerMonth', 'aiInputTokens', 'aiOutputTokens']),
  ]);
  return {
    month: month(), users: users.count, spaces: spaces.count, businessSpaces: business.count, telegramLinked: telegramLinks.count,
    reminders: { scheduled: scheduled.count, failed: failed.count, undeliverable: undeliverable.count },
    assistantMessages: usage.sums.assistantPerMonth, aiTokens: { input: usage.sums.aiInputTokens, output: usage.sums.aiOutputTokens },
  };
}

export async function adminSetPlan(uid: string, input: { spaceId: string; plan: PlanId }) {
  requireAdmin(uid);
  const ref = db.doc(`spaces/${input.spaceId}`);
  await db.runTransaction(async (tx) => {
    if (!(await tx.get(ref)).exists) fail('not-found', 'Espacio no encontrado.');
    tx.update(ref, { plan: input.plan, updatedAt: FieldValue.serverTimestamp() });
    tx.create(db.collection(`spaces/${input.spaceId}/audit`).doc(), { actorId: uid, source: 'pwa', op: 'admin.setPlan', target: ref.path, details: { plan: input.plan }, result: 'ok', at: FieldValue.serverTimestamp() });
  });
  return { ok: true };
}

/**
 * Mantenimiento (cada 15 min desde el Cron): borra códigos de vinculación vencidos y avisa al
 * administrador por Telegram si hay recordatorios fallidos nuevos (ADMIN_TELEGRAM_CHAT_ID).
 */
export async function housekeeping(now = new Date()) {
  const expired = await db.collection('telegramLinkCodes').where('expiresAt', '<', Timestamp.fromDate(new Date(now.getTime() - 3_600_000))).limit(200).get();
  if (expired.size) await db.deleteMany(expired.docs.map((d) => d.ref));

  let alerted = 0;
  const chat = Number(process.env.ADMIN_TELEGRAM_CHAT_ID);
  if (chat) {
    const stateRef = db.doc('system/alerts');
    const last = ((await stateRef.get()).get('lastCheck') as Timestamp | undefined) ?? Timestamp.fromMillis(0);
    const fresh = await db.collectionGroup('reminders').where('status', '==', 'failed').where('updatedAt', '>', last).aggregate();
    if (fresh.count) {
      await telegram.send(chat, `⚠️ Aguiteks LifeOS: ${fresh.count} recordatorio(s) fallaron desde la última revisión. Revisa los logs (wrangler tail).`)
        .then(() => (alerted = fresh.count), (err) => logger.error('alerts.send', { error: (err as Error).message }));
    }
    await stateRef.set({ lastCheck: Timestamp.fromDate(now) });
  }
  return { expiredCodes: expired.size, alerted };
}
