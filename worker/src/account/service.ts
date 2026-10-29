import type { MemberDoc, UserDoc } from '@lifeos/contracts';
import { db, FieldValue } from '../shared/firebase';
import type { DocumentReference } from '../shared/firestore';
import { fail } from '../shared/errors';
import { deleteAuthUser } from '../shared/google-auth';
import { logger } from '../shared/log';

/** Subcolecciones de un espacio (mantener al día al agregar módulos). */
export const SPACE_COLLECTIONS = [
  'members', 'tasks', 'reminders', 'contacts', 'activities', 'projects', 'opportunities', 'documents', 'documentFiles',
  'accounts', 'transactions', 'obligations', 'budgets', 'goals', 'goalContributions', 'audit', 'usage',
] as const;

async function memberships(uid: string) {
  const snap = await db.collectionGroup('members').where('uid', '==', uid).get();
  return snap.docs.map((d) => ({ ref: d.ref, ...(d.data() as MemberDoc) }));
}

/**
 * Exportación de datos (portabilidad): perfil, membresías y todo el contenido de los espacios donde la
 * persona es propietaria. Los archivos se exportan como metadatos (se descargan uno a uno en la app).
 */
export async function exportAccount(uid: string) {
  const [user, mems] = await Promise.all([db.doc(`users/${uid}`).get(), memberships(uid)]);
  const owned = mems.filter((m) => m.role === 'owner' && m.status === 'active');
  const spaces: Record<string, unknown> = {};
  for (const m of owned) {
    const space = (await db.doc(`spaces/${m.spaceId}`).get()).data();
    const data: Record<string, unknown[]> = {};
    for (const col of SPACE_COLLECTIONS) {
      if (col === 'documentFiles') continue;
      const snap = await db.collection(`spaces/${m.spaceId}/${col}`).get();
      data[col] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
    spaces[m.spaceId] = { ...space, data };
  }
  const profile = user.data() as UserDoc | undefined;
  return {
    exportedAt: new Date().toISOString(),
    profile: profile ? { ...profile, telegram: profile.telegram ? { linked: true } : null } : null,
    memberships: mems.map(({ ref: _, ...m }) => m),
    spaces,
  };
}

async function allDocs(path: string): Promise<DocumentReference[]> {
  return (await db.collection(path).get()).docs.map((d) => d.ref);
}

/**
 * Eliminación de cuenta. Bloquea si la persona es dueña de un espacio de empresa con otros miembros
 * (perderían sus datos): primero debe transferirlo o quitarlos. Borra sus espacios propios, sale de
 * los ajenos, revoca Telegram y elimina el usuario de Auth. Las copias de seguridad expiran aparte.
 */
export async function deleteAccount(uid: string) {
  const mems = await memberships(uid);
  const owned = mems.filter((m) => m.role === 'owner' && m.status === 'active');
  for (const m of owned.filter((x) => x.spaceType === 'business')) {
    const others = await db.collection(`spaces/${m.spaceId}/members`).where('status', '==', 'active').aggregate();
    if (others.count > 1) fail('failed-precondition', `Eres propietario de «${m.spaceName}», que tiene otros miembros. Quítalos o elimina ese espacio antes de borrar tu cuenta.`);
  }
  const user = (await db.doc(`users/${uid}`).get()).data() as UserDoc | undefined;

  for (const m of owned) {
    const refs = (await Promise.all(SPACE_COLLECTIONS.map((c) => allDocs(`spaces/${m.spaceId}/${c}`)))).flat();
    await db.deleteMany([...refs, db.doc(`spaces/${m.spaceId}`)]);
  }
  for (const m of mems.filter((x) => x.role !== 'owner' && x.status !== 'removed')) {
    await m.ref.update({ status: 'removed', updatedAt: FieldValue.serverTimestamp() });
  }
  const extra = [db.doc(`users/${uid}`)];
  if (user?.telegram) extra.push(db.doc(`telegramLinks/${user.telegram.chatId}`), db.doc(`conversations/tg_${user.telegram.chatId}`));
  extra.push(db.doc(`conversations/pwa_${uid}`));
  await db.deleteMany(extra);
  // Registro mínimo de la eliminación (sin datos personales) para auditoría.
  await db.doc(`deletedAccounts/${uid}`).set({ deletedAt: FieldValue.serverTimestamp(), spacesDeleted: owned.length });
  await deleteAuthUser(uid).catch((err) => logger.error('account.delete.auth', { error: (err as Error).message }));
  return { deleted: true, spacesDeleted: owned.length };
}
