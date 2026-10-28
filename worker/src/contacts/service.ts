import type { ContactDoc, OpData } from '@lifeos/contracts';
import { db, FieldValue, Timestamp } from '../shared/firebase';
import { fail } from '../shared/errors';
import { audit } from '../shared/audit';
import { zoned } from '../shared/time';
import { requirePerm, type Ctx } from '../auth/context';
import { createReminderTx } from '../reminders/service';

const col = (ctx: Ctx) => db.collection(`spaces/${ctx.spaceId}/contacts`);
export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const digits = (s: string) => s.replace(/\D/g, '').slice(-8); // últimos 8 dígitos: ignora +502 y formato

/** Posibles duplicados por teléfono o correo. No se combinan automáticamente: solo se avisa. */
async function findDuplicates(ctx: Ctx, phones: string[], emails: string[]) {
  const all = await col(ctx).where('archived', '==', false).limit(1000).get();
  const p = new Set(phones.map(digits));
  const e = new Set(emails);
  return all.docs
    .filter((d) => (d.get('phones') as string[]).some((x) => p.has(digits(x))) || (d.get('emails') as string[]).some((x) => e.has(x)))
    .map((d) => d.id);
}

export async function createContact(ctx: Ctx, input: OpData<'contact.create'>) {
  requirePerm(ctx, 'core.write');
  const possibleDuplicates = input.phones.length || input.emails.length ? await findDuplicates(ctx, input.phones, input.emails) : [];
  const ref = col(ctx).doc(input.requestId);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return { contactId: ref.id, duplicate: true, possibleDuplicates: [] };
    const { requestId: _, ...data } = input;
    tx.create(ref, {
      ...data, nameLower: norm(input.name),
      company: input.company ?? null, jobTitle: input.jobTitle ?? null, notes: input.notes ?? null,
      archived: false, lastContactAt: null, createdBy: ctx.uid, source: ctx.source,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    audit(tx, ctx, 'contact.create', ref.path);
    return { contactId: ref.id, duplicate: false, possibleDuplicates };
  });
}

export async function updateContact(ctx: Ctx, input: OpData<'contact.update'>) {
  requirePerm(ctx, 'core.write');
  const ref = col(ctx).doc(input.contactId);
  const { contactId: _, ...rest } = input;
  const patch: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  if (input.name) patch.nameLower = norm(input.name);
  await db.runTransaction(async (tx) => {
    if (!(await tx.get(ref)).exists) fail('not-found', 'Contacto no encontrado.');
    tx.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, 'contact.update', ref.path, { fields: Object.keys(patch) });
  });
  return { ok: true };
}

export async function archiveContact(ctx: Ctx, input: OpData<'contact.archive'>) {
  requirePerm(ctx, 'core.write');
  const ref = col(ctx).doc(input.contactId);
  await db.runTransaction(async (tx) => {
    if (!(await tx.get(ref)).exists) fail('not-found', 'Contacto no encontrado.');
    tx.update(ref, { archived: true, updatedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, 'contact.archive', ref.path);
  });
  return { ok: true };
}

/** Búsqueda sin tildes por nombre, empresa, correo, teléfono o etiqueta. */
export async function searchContacts(ctx: Ctx, q: string, limit = 10) {
  requirePerm(ctx, 'core.read');
  const term = norm(q);
  const tel = q.replace(/\D/g, '');
  // ponytail: filtra en memoria hasta 1000 contactos; índice de búsqueda (p. ej. tokens) si un espacio crece más.
  const all = await col(ctx).where('archived', '==', false).orderBy('nameLower').limit(1000).get();
  return all.docs
    .map((d) => ({ id: d.id, ...(d.data() as ContactDoc) }))
    .filter((c) =>
      [c.name, c.company ?? '', c.jobTitle ?? '', ...c.emails, ...c.tags].some((f) => norm(f).includes(term)) ||
      (tel.length >= 4 && c.phones.some((p) => p.replace(/\D/g, '').includes(tel))))
    .slice(0, limit);
}

/** Llamada, mensaje, reunión o nota; con seguimiento opcional (crea el recordatorio en la misma transacción). */
export async function recordActivity(ctx: Ctx, input: OpData<'activity.create'>) {
  requirePerm(ctx, 'core.write');
  const ref = db.doc(`spaces/${ctx.spaceId}/activities/${input.requestId}`);
  const contactRef = input.contactId ? col(ctx).doc(input.contactId) : null;
  const follow = input.followUpAt
    ? Timestamp.fromDate(zoned(input.followUpAt.slice(0, 10), input.followUpAt.slice(11), ctx.space.timezone))
    : null;
  if (follow && follow.toMillis() < Date.now() - 60_000) fail('invalid-argument', 'La fecha de seguimiento ya pasó.');
  return db.runTransaction(async (tx) => {
    const [dup, contact] = await Promise.all([tx.get(ref), contactRef ? tx.get(contactRef) : null]);
    if (dup.exists) return { activityId: ref.id, duplicate: true };
    if (contactRef && !contact?.exists) fail('invalid-argument', 'El contacto no existe en este espacio.');
    const name = contact?.get('name') as string | undefined;
    const reminder = follow
      ? createReminderTx(tx, ctx, `${ref.id}_f`, { title: `Seguimiento${name ? `: ${name}` : ''} — ${input.summary.slice(0, 120)}`, when: follow })
      : null;
    tx.create(ref, {
      type: input.type, summary: input.summary, contactId: input.contactId ?? null,
      followUpReminderId: reminder?.id ?? null, createdBy: ctx.uid, source: ctx.source,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (contactRef) tx.update(contactRef, { lastContactAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, 'activity.create', ref.path);
    return { activityId: ref.id, duplicate: false, followUpReminderId: reminder?.id ?? null };
  });
}
