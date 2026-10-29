import { DateTime } from 'luxon';
import { MAX_FILE_BYTES, type DocumentDoc, type OpData } from '@lifeos/contracts';
import { db, FieldValue, Timestamp } from '../shared/firebase';
import { fail } from '../shared/errors';
import { audit } from '../shared/audit';
import { requirePerm, type Ctx } from '../auth/context';
import { createReminderTx } from '../reminders/service';

// Documentos y vencimientos. El archivo vive en spaces/{s}/documentFiles/{id} (base64, ≤ 700 KB):
// Firestore del plan gratuito, sin Cloud Storage (exige facturación). Los clientes no pueden leerlo
// directo (reglas): se descarga por la API tras comprobar permisos.
// ponytail: un archivo por documento de hasta 700 KB; para archivos grandes, fragmentar en varios documentos.

const meta = (ctx: Ctx, id: string) => db.doc(`spaces/${ctx.spaceId}/documents/${id}`);
const content = (ctx: Ctx, id: string) => db.doc(`spaces/${ctx.spaceId}/documentFiles/${id}`);

/** Tipo real por los primeros bytes; nunca se confía en el nombre ni en el MIME que manda el cliente. */
export function sniffMime(base64: string): string | null {
  let head: string;
  try {
    head = atob(base64.slice(0, 24));
  } catch {
    return null;
  }
  const b = [...head].map((c) => c.charCodeAt(0));
  if (head.startsWith('%PDF-')) return 'application/pdf';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && head.slice(1, 4) === 'PNG') return 'image/png';
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const byteLength = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

export async function createDocument(ctx: Ctx, input: OpData<'document.create'>) {
  requirePerm(ctx, 'core.write');
  let file: DocumentDoc['file'] = null;
  if (input.file) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.file.base64)) fail('invalid-argument', 'Archivo dañado.');
    const mime = sniffMime(input.file.base64);
    if (!mime) fail('invalid-argument', 'Solo se aceptan PDF, JPG, PNG o WEBP.');
    const size = byteLength(input.file.base64);
    if (size > MAX_FILE_BYTES) fail('invalid-argument', 'El archivo supera 700 KB.');
    file = { name: input.file.name.replace(/[\\/]/g, '_'), mime: mime!, size };
  }
  let remindAt: Timestamp | null = null;
  if (input.expiresAt && input.remindDaysBefore !== undefined) {
    const at = DateTime.fromISO(`${input.expiresAt}T08:00`, { zone: ctx.space.timezone }).minus({ days: input.remindDaysBefore });
    if (at.toMillis() > Date.now()) remindAt = Timestamp.fromDate(at.toJSDate());
  }
  const r = meta(ctx, input.requestId);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(r)).exists) return { documentId: r.id, duplicate: true, reminderId: null };
    if (input.contactId && !(await tx.get(db.doc(`spaces/${ctx.spaceId}/contacts/${input.contactId}`))).exists) fail('invalid-argument', 'El contacto no existe en este espacio.');
    const reminder = remindAt ? createReminderTx(tx, ctx, `${r.id}_v`, { title: `Vence: ${input.title}`, when: remindAt }) : null;
    tx.create(r, {
      title: input.title, type: input.type, issuer: input.issuer ?? null, issuedAt: input.issuedAt ?? null, expiresAt: input.expiresAt ?? null,
      tags: input.tags, contactId: input.contactId ?? null, file, reminderId: reminder?.id ?? null,
      createdBy: ctx.uid, source: ctx.source, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    if (file) tx.create(content(ctx, r.id), { data: input.file!.base64, mime: file.mime });
    audit(tx, ctx, 'document.create', r.path, { type: input.type, size: file?.size ?? 0 });
    return { documentId: r.id, duplicate: false, reminderId: reminder?.id ?? null };
  });
}

export async function updateDocument(ctx: Ctx, input: OpData<'document.update'>) {
  requirePerm(ctx, 'core.write');
  const r = meta(ctx, input.documentId);
  const { documentId: _, ...rest } = input;
  const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  await db.runTransaction(async (tx) => {
    if (!(await tx.get(r)).exists) fail('not-found', 'Documento no encontrado.');
    tx.update(r, { ...patch, updatedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, 'document.update', r.path, { fields: Object.keys(patch) });
  });
  return { ok: true };
}

export async function downloadDocument(ctx: Ctx, input: OpData<'document.download'>) {
  requirePerm(ctx, 'core.read');
  const [m, c] = await Promise.all([meta(ctx, input.documentId).get(), content(ctx, input.documentId).get()]);
  const d = m.data() as DocumentDoc | undefined;
  if (!d?.file || !c.exists) fail('not-found', 'Este documento no tiene archivo.');
  return { name: d!.file!.name, mime: d!.file!.mime, base64: c.get('data') as string };
}

export async function deleteDocument(ctx: Ctx, input: OpData<'document.delete'>) {
  requirePerm(ctx, 'core.write');
  const r = meta(ctx, input.documentId);
  await db.runTransaction(async (tx) => {
    const d = (await tx.get(r)).data() as DocumentDoc | undefined;
    if (!d) fail('not-found', 'Documento no encontrado.');
    if (d!.reminderId) tx.update(db.doc(`spaces/${ctx.spaceId}/reminders/${d!.reminderId}`), { status: 'cancelled', version: FieldValue.increment(1) });
    tx.delete(content(ctx, r.id));
    tx.delete(r);
    audit(tx, ctx, 'document.delete', r.path, { title: d!.title });
  });
  return { ok: true };
}
