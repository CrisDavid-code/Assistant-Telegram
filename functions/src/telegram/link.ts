import { createHash, randomInt } from 'node:crypto';
import type { Source, UserDoc } from '@lifeos/contracts';
import { db, FieldValue, Timestamp } from '../shared/firebase';
import { fail } from '../shared/errors';
import { audit } from '../shared/audit';

// Sin 0/O/1/I/L para que se pueda dictar. 10 caracteres de 31 símbolos ≈ 49 bits, un solo uso, 10 minutos.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_RE = /^[A-HJKMNP-Z2-9]{10}$/;
const TTL_MS = 10 * 60_000;
const hash = (code: string) => createHash('sha256').update(code).digest('hex');

export async function createLinkCode(uid: string) {
  const user = (await db.doc(`users/${uid}`).get()).data() as UserDoc | undefined;
  if (!user) fail('failed-precondition', 'Primero completa tu registro.');
  const code = Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  const expiresAt = Timestamp.fromMillis(Date.now() + TTL_MS);
  // Solo se guarda el hash: quien lea la base de datos no puede usar el código.
  await db.doc(`telegramLinkCodes/${hash(code)}`).create({ uid, expiresAt, usedAt: null, createdAt: FieldValue.serverTimestamp() });
  const bot = process.env.TELEGRAM_BOT_USERNAME;
  return { code, expiresAt: expiresAt.toDate().toISOString(), deepLink: bot ? `https://t.me/${bot}?start=${code}` : null };
}

/** Vincula el chat con la cuenta dueña del código. Atómico; el código queda inválido aunque falle después. */
export async function linkChat(code: string, chat: { chatId: number; username: string | null }) {
  const codeRef = db.doc(`telegramLinkCodes/${hash(code)}`);
  const linkRef = db.doc(`telegramLinks/${chat.chatId}`);
  return db.runTransaction(async (tx) => {
    const [c, link] = await Promise.all([tx.get(codeRef), tx.get(linkRef)]);
    // Mismo mensaje para inexistente, usado o vencido: no se revela cuál fue.
    if (!c.exists || c.get('usedAt') || (c.get('expiresAt') as Timestamp).toMillis() < Date.now()) {
      fail('permission-denied', 'El código no es válido o ya venció. Genera uno nuevo en la app.');
    }
    const uid = c.get('uid') as string;
    if (link.exists && link.get('uid') !== uid) fail('failed-precondition', 'Este chat ya está vinculado a otra cuenta. Desvincúlala primero con /desvincular.');
    const userRef = db.doc(`users/${uid}`);
    const user = (await tx.get(userRef)).data() as UserDoc;
    // Una cuenta = un chat: si había otro chat vinculado, se revoca.
    if (user.telegram && user.telegram.chatId !== chat.chatId) tx.delete(db.doc(`telegramLinks/${user.telegram.chatId}`));
    tx.update(codeRef, { usedAt: FieldValue.serverTimestamp() });
    tx.set(linkRef, { uid, username: chat.username, linkedAt: FieldValue.serverTimestamp() });
    tx.update(userRef, { telegram: { chatId: chat.chatId, username: chat.username, linkedAt: FieldValue.serverTimestamp() } });
    tx.delete(db.doc(`conversations/tg_${chat.chatId}`));
    audit(tx, { spaceId: user.personalSpaceId, uid, source: 'telegram' }, 'telegram.link', linkRef.path);
    return { uid, displayName: user.displayName };
  });
}

export async function unlinkTelegram(uid: string, source: Source) {
  const userRef = db.doc(`users/${uid}`);
  return db.runTransaction(async (tx) => {
    const user = (await tx.get(userRef)).data() as UserDoc | undefined;
    if (!user?.telegram) return { unlinked: false };
    tx.delete(db.doc(`telegramLinks/${user.telegram.chatId}`));
    tx.delete(db.doc(`conversations/tg_${user.telegram.chatId}`));
    tx.update(userRef, { telegram: null });
    audit(tx, { spaceId: user.personalSpaceId, uid, source }, 'telegram.unlink', `telegramLinks/${user.telegram.chatId}`);
    return { unlinked: true, chatId: user.telegram.chatId };
  });
}

export async function uidForChat(chatId: number) {
  const link = await db.doc(`telegramLinks/${chatId}`).get();
  return link.exists ? (link.get('uid') as string) : null;
}
