import { DateTime } from 'luxon';
import type { OpData, Recurrence, ReminderDoc, UserDoc } from '@lifeos/contracts';
import { db, FieldValue, Timestamp, type Tx } from '../shared/firebase';
import { fail } from '../shared/errors';
import { audit } from '../shared/audit';
import { nextOccurrence, zoned } from '../shared/time';
import { requirePerm, type Ctx } from '../auth/context';
import { esc, telegram } from '../telegram/api';

const col = (spaceId: string) => db.collection(`spaces/${spaceId}/reminders`);
export const MAX_ATTEMPTS = 5;
const LEASE_MS = 2 * 60_000;

function futureTs(ctx: Ctx, at: string, now = new Date()) {
  const [date, time] = at.split('T') as [string, string];
  const when = zoned(date, time, ctx.space.timezone);
  // Un minuto de gracia: "a las 8:00" dicho a las 8:00:30 no debería fallar.
  if (when.getTime() < now.getTime() - 60_000) fail('invalid-argument', 'Esa fecha y hora ya pasaron.');
  return Timestamp.fromDate(when);
}

/** Crea el documento dentro de una transacción existente (lo usan tareas, obligaciones y actividades). */
export function createReminderTx(tx: Tx, ctx: Ctx, id: string, r: { title: string; when: Timestamp; recurrence?: Recurrence; taskId?: string; obligationId?: string }) {
  const ref = col(ctx.spaceId).doc(id);
  tx.create(ref, {
    spaceId: ctx.spaceId, title: r.title, userId: ctx.uid,
    dueAt: r.when, scheduledFor: r.when, timezone: ctx.space.timezone,
    recurrence: r.recurrence ?? null, anchorDay: DateTime.fromJSDate(r.when.toDate(), { zone: ctx.space.timezone }).day,
    status: 'scheduled', version: 1, attempts: 0, lockedUntil: null, lastError: null, deliveredAt: null,
    taskId: r.taskId ?? null, obligationId: r.obligationId ?? null,
    createdBy: ctx.uid, source: ctx.source,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  return ref;
}

export async function createReminder(ctx: Ctx, input: OpData<'reminder.create'>) {
  requirePerm(ctx, 'core.write');
  const when = futureTs(ctx, input.at);
  return db.runTransaction(async (tx) => {
    const ref = col(ctx.spaceId).doc(input.requestId);
    if ((await tx.get(ref)).exists) return { reminderId: ref.id, duplicate: true };
    createReminderTx(tx, ctx, ref.id, { title: input.title, when, recurrence: input.recurrence, taskId: input.taskId, obligationId: input.obligationId });
    audit(tx, ctx, 'reminder.create', ref.path);
    return { reminderId: ref.id, duplicate: false };
  });
}

async function mutate(ctx: Ctx, reminderId: string, op: string, patch: (r: ReminderDoc) => Record<string, unknown>) {
  requirePerm(ctx, 'core.write');
  const ref = col(ctx.spaceId).doc(reminderId);
  await db.runTransaction(async (tx) => {
    const r = (await tx.get(ref)).data() as ReminderDoc | undefined;
    if (!r) fail('not-found', 'Recordatorio no encontrado.');
    if (r!.status === 'cancelled') fail('failed-precondition', 'El recordatorio está cancelado.');
    // Subir la versión invalida cualquier envío en curso con la programación anterior.
    tx.update(ref, { ...patch(r!), version: FieldValue.increment(1), lockedUntil: null, updatedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, op, ref.path);
  });
  return { ok: true };
}

export const rescheduleReminder = (ctx: Ctx, input: OpData<'reminder.reschedule'>) => {
  const when = futureTs(ctx, input.at);
  return mutate(ctx, input.reminderId, 'reminder.reschedule', () => ({ dueAt: when, scheduledFor: when, status: 'scheduled', attempts: 0, lastError: null }));
};

export const cancelReminder = (ctx: Ctx, input: OpData<'reminder.cancel'>) =>
  mutate(ctx, input.reminderId, 'reminder.cancel', () => ({ status: 'cancelled' }));

// ── Entrega duradera ────────────────────────────────────────────────────────────────────────────────
// Un proceso programado (cada minuto) busca recordatorios vencidos y los entrega. El estado vive en
// Firestore: un reinicio no pierde nada, y "sending" con el plazo vencido se recupera en la siguiente pasada.
// Entrega al menos una vez: si el proceso muere después de enviar y antes de guardar, puede repetirse.

/** Toma un recordatorio en exclusiva. Devuelve la versión tomada o null si ya no corresponde enviarlo. */
async function claim(ref: FirebaseFirestore.DocumentReference, now: Date) {
  return db.runTransaction(async (tx) => {
    const r = (await tx.get(ref)).data() as ReminderDoc | undefined;
    if (!r) return null;
    const due = r.dueAt.toMillis() <= now.getTime();
    const stale = r.status === 'sending' && (r.lockedUntil?.toMillis() ?? 0) <= now.getTime();
    if (!((r.status === 'scheduled' && due) || stale)) return null;
    tx.update(ref, { status: 'sending', lockedUntil: Timestamp.fromMillis(now.getTime() + LEASE_MS), attempts: FieldValue.increment(1) });
    return { ...r, attempts: r.attempts + 1 };
  });
}

/** Guarda el resultado solo si nadie reprogramó/canceló mientras se enviaba (misma versión y aún "sending"). */
async function finish(ref: FirebaseFirestore.DocumentReference, version: number, patch: Record<string, unknown>) {
  await db.runTransaction(async (tx) => {
    const r = (await tx.get(ref)).data() as ReminderDoc | undefined;
    if (!r || r.version !== version || r.status !== 'sending') return;
    tx.update(ref, { ...patch, lockedUntil: null, updatedAt: FieldValue.serverTimestamp() });
  });
}

export async function deliverReminder(ref: FirebaseFirestore.DocumentReference, now = new Date()) {
  const r = await claim(ref, now);
  if (!r) return 'skipped';
  const user = (await db.doc(`users/${r.userId}`).get()).data() as UserDoc | undefined;
  const next = r.recurrence ? nextOccurrence(r.scheduledFor.toDate(), r.timezone, r.recurrence, r.anchorDay) : null;
  const advance = next
    ? { status: 'scheduled', scheduledFor: Timestamp.fromDate(next), dueAt: Timestamp.fromDate(next), attempts: 0 }
    : null;

  if (!user?.telegram) {
    // Sin canal no se finge una entrega: queda visible en la PWA como "no enviado".
    await finish(ref, r.version, advance ? { ...advance, lastError: 'Sin Telegram vinculado' } : { status: 'undeliverable', lastError: 'Sin Telegram vinculado' });
    return 'undeliverable';
  }
  try {
    await telegram.send(user.telegram.chatId, `⏰ <b>Recordatorio</b>\n${esc(r.title)}`);
    await finish(ref, r.version, { ...(advance ?? { status: 'delivered' }), deliveredAt: Timestamp.fromDate(now), lastError: null });
    return 'delivered';
  } catch (err) {
    const msg = String((err as Error).message).slice(0, 200);
    const retry = r.attempts < MAX_ATTEMPTS;
    await finish(ref, r.version, retry
      ? { status: 'scheduled', dueAt: Timestamp.fromMillis(now.getTime() + 2 ** r.attempts * 60_000), lastError: msg }
      : advance ? { ...advance, lastError: msg } : { status: 'failed', lastError: msg });
    return retry ? 'retry' : 'failed';
  }
}

export async function sweepReminders(now = new Date()) {
  const ts = Timestamp.fromDate(now);
  const [due, stale] = await Promise.all([
    db.collectionGroup('reminders').where('status', '==', 'scheduled').where('dueAt', '<=', ts).orderBy('dueAt').limit(200).get(),
    db.collectionGroup('reminders').where('status', '==', 'sending').where('lockedUntil', '<=', ts).limit(50).get(),
  ]);
  const results = await Promise.all([...due.docs, ...stale.docs].map((d) => deliverReminder(d.ref, now)));
  return results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r]: (acc[r] ?? 0) + 1 }), {});
}
