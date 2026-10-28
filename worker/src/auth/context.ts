import { can, type MemberDoc, type Permission, type Role, type SpaceDoc, type Source } from '@lifeos/contracts';
import { db } from '../shared/firebase';
import { fail } from '../shared/errors';

/** Contexto autorizado: identidad + espacio + rol verificados en Firestore, nunca tomados del cliente. */
export interface Ctx {
  uid: string;
  spaceId: string;
  role: Role;
  space: SpaceDoc;
  source: Source;
}

export async function loadCtx(uid: string, spaceId: string, source: Source): Promise<Ctx> {
  const [mem, space] = await Promise.all([
    db.doc(`spaces/${spaceId}/members/${uid}`).get(),
    db.doc(`spaces/${spaceId}`).get(),
  ]);
  const m = mem.data() as MemberDoc | undefined;
  const s = space.data() as SpaceDoc | undefined;
  // Mismo mensaje si el espacio no existe o no es miembro: no revela qué espacios existen.
  if (!m || !s || m.status !== 'active' || s.status !== 'active') fail('permission-denied', 'No tienes acceso a este espacio.');
  return { uid, spaceId, role: m!.role, space: s!, source };
}

export function requirePerm(ctx: Ctx, perm: Permission) {
  if (!can(ctx.role, perm)) fail('permission-denied', 'Tu rol en este espacio no permite esta acción.');
}
