import { PLANS, type Currency, type MemberDoc, type OpData, type SpaceDoc, type Source, type UserDoc } from '@lifeos/contracts';
import { db, FieldValue } from '../shared/firebase';
import { fail } from '../shared/errors';
import { audit } from '../shared/audit';
import { userByEmail } from '../shared/google-auth';
import { requirePerm, type Ctx } from '../auth/context';


export const MAX_OWNED_BUSINESS_SPACES = PLANS.free.businessSpaces;

const memberRef = (spaceId: string, uid: string) => db.doc(`spaces/${spaceId}/members/${uid}`);

function newSpace(ownerId: string, name: string, type: SpaceDoc['type'], timezone: string, currency: Currency) {
  return {
    name, type, ownerId, timezone, currency,
    status: 'active', plan: 'free',
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  };
}

function newMember(uid: string, spaceId: string, space: { name: string; type: SpaceDoc['type'] }, role: MemberDoc['role'], status: MemberDoc['status'], who: { displayName: string; email: string | null }, invitedBy: string | null) {
  return {
    uid, spaceId, spaceName: space.name, spaceType: space.type, role, status,
    displayName: who.displayName, email: who.email, invitedBy,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  };
}

/** Crea perfil + espacio personal la primera vez. Idempotente: si ya existe, devuelve el existente. */
export async function bootstrapUser(uid: string, profile: { email: string | null; name: string | null }, input: OpData<'user.bootstrap'>, source: Source) {
  const userRef = db.doc(`users/${uid}`);
  return db.runTransaction(async (tx) => {
    const existing = await tx.get(userRef);
    if (existing.exists) return { created: false, personalSpaceId: (existing.data() as UserDoc).personalSpaceId };
    const displayName = input.displayName || profile.name || profile.email?.split('@')[0] || 'Usuario';
    const spaceRef = db.collection('spaces').doc();
    tx.create(spaceRef, newSpace(uid, 'Personal', 'personal', input.timezone ?? 'America/Guatemala', input.currency ?? 'GTQ'));
    tx.create(memberRef(spaceRef.id, uid), newMember(uid, spaceRef.id, { name: 'Personal', type: 'personal' }, 'owner', 'active', { displayName, email: profile.email }, null));
    tx.create(userRef, {
      displayName, email: profile.email, personalSpaceId: spaceRef.id, defaultSpaceId: spaceRef.id,
      telegram: null, ownedBusinessSpaces: 0, createdAt: FieldValue.serverTimestamp(),
    });
    audit(tx, { spaceId: spaceRef.id, uid, source }, 'user.bootstrap', `users/${uid}`);
    return { created: true, personalSpaceId: spaceRef.id };
  });
}

export async function createBusinessSpace(uid: string, input: OpData<'space.create'>, source: Source) {
  const userRef = db.doc(`users/${uid}`);
  const spaceRef = db.doc(`spaces/${input.requestId}`);
  return db.runTransaction(async (tx) => {
    const [user, dup] = await Promise.all([tx.get(userRef), tx.get(spaceRef)]);
    if (dup.exists) {
      if (dup.data()!.ownerId !== uid) fail('already-exists', 'Identificador en uso.');
      return { spaceId: spaceRef.id, duplicate: true };
    }
    const u = user.data() as (UserDoc & { ownedBusinessSpaces?: number }) | undefined;
    if (!u) fail('failed-precondition', 'Primero completa tu registro.');
    if ((u!.ownedBusinessSpaces ?? 0) >= MAX_OWNED_BUSINESS_SPACES) {
      fail('resource-exhausted', `Tu plan permite hasta ${MAX_OWNED_BUSINESS_SPACES} espacios de empresa.`);
    }
    tx.create(spaceRef, newSpace(uid, input.name, 'business', input.timezone, input.currency));
    tx.create(memberRef(spaceRef.id, uid), newMember(uid, spaceRef.id, { name: input.name, type: 'business' }, 'owner', 'active', { displayName: u!.displayName, email: u!.email }, null));
    tx.update(userRef, { ownedBusinessSpaces: FieldValue.increment(1) });
    audit(tx, { spaceId: spaceRef.id, uid, source }, 'space.create', `spaces/${spaceRef.id}`, { name: input.name });
    return { spaceId: spaceRef.id, duplicate: false };
  });
}

export async function updateSpace(ctx: Ctx, input: OpData<'space.update'>) {
  requirePerm(ctx, 'space.manage');
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  if (!Object.keys(patch).length) return { updated: false };
  const members = input.name ? await db.collection(`spaces/${ctx.spaceId}/members`).get() : null;
  await db.runTransaction(async (tx) => {
    tx.update(db.doc(`spaces/${ctx.spaceId}`), { ...patch, updatedAt: FieldValue.serverTimestamp() });
    // ponytail: nombre denormalizado en ≤ 400 miembros por transacción; lotes si un espacio crece más.
    members?.docs.slice(0, 400).forEach((m) => tx.update(m.ref, { spaceName: input.name }));
    audit(tx, ctx, 'space.update', `spaces/${ctx.spaceId}`, patch);
  });
  return { updated: true };
}

export async function inviteMember(ctx: Ctx, input: OpData<'member.invite'>) {
  requirePerm(ctx, 'members.manage');
  if (ctx.space.type === 'personal') fail('failed-precondition', 'El espacio personal no admite miembros. Crea un espacio de empresa.');
  if (input.role === 'admin' && ctx.role !== 'owner') fail('permission-denied', 'Solo el propietario puede nombrar administradores.');
  const target = await userByEmail(input.email);
  if (!target) fail('not-found', 'Esa persona aún no tiene cuenta en Aguiteks LifeOS. Pídele que se registre primero.');
  const ref = memberRef(ctx.spaceId, target!.uid);
  return db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as MemberDoc | undefined;
    if (cur?.status === 'active') fail('already-exists', 'Esa persona ya es miembro del espacio.');
    tx.set(ref, newMember(target!.uid, ctx.spaceId, ctx.space, input.role, 'invited', { displayName: target!.displayName ?? input.email, email: input.email }, ctx.uid));
    audit(tx, ctx, 'member.invite', ref.path, { role: input.role });
    return { uid: target!.uid };
  });
}

/** El invitado acepta o rechaza. No usa loadCtx porque todavía no es miembro activo. */
export async function respondInvite(uid: string, spaceId: string, input: OpData<'member.respond'>, source: Source) {
  const ref = memberRef(spaceId, uid);
  return db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as MemberDoc | undefined;
    if (cur?.status !== 'invited') fail('not-found', 'No tienes una invitación pendiente para este espacio.');
    tx.update(ref, { status: input.accept ? 'active' : 'removed', updatedAt: FieldValue.serverTimestamp() });
    audit(tx, { spaceId, uid, source }, input.accept ? 'member.accept' : 'member.decline', ref.path);
    return { status: input.accept ? 'active' : 'removed' };
  });
}

async function editableMember(ctx: Ctx, uid: string) {
  const snap = await memberRef(ctx.spaceId, uid).get();
  const m = snap.data() as MemberDoc | undefined;
  if (!m || m.status === 'removed') fail('not-found', 'Miembro no encontrado.');
  if (m!.role === 'owner') fail('permission-denied', 'No se puede modificar al propietario del espacio.');
  if (m!.role === 'admin' && ctx.role !== 'owner') fail('permission-denied', 'Solo el propietario puede modificar administradores.');
  return m!;
}

export async function updateMember(ctx: Ctx, input: OpData<'member.update'>) {
  requirePerm(ctx, 'members.manage');
  if (input.uid === ctx.uid) fail('failed-precondition', 'No puedes cambiar tu propio rol.');
  await editableMember(ctx, input.uid);
  if (input.role === 'admin' && ctx.role !== 'owner') fail('permission-denied', 'Solo el propietario puede nombrar administradores.');
  await db.runTransaction(async (tx) => {
    const ref = memberRef(ctx.spaceId, input.uid);
    tx.update(ref, { role: input.role, updatedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, 'member.update', ref.path, { role: input.role });
  });
  return { ok: true };
}

/** Quitar a alguien (admin) o salir uno mismo. La membresía queda "removed": no se transfiere nada. */
export async function removeMember(ctx: Ctx, input: OpData<'member.remove'>) {
  if (input.uid === ctx.uid) {
    if (ctx.role === 'owner') fail('failed-precondition', 'El propietario no puede salir de su propio espacio.');
  } else {
    requirePerm(ctx, 'members.manage');
    await editableMember(ctx, input.uid);
  }
  const userRef = db.doc(`users/${input.uid}`);
  await db.runTransaction(async (tx) => {
    const user = (await tx.get(userRef)).data() as UserDoc | undefined;
    const ref = memberRef(ctx.spaceId, input.uid);
    tx.update(ref, { status: 'removed', updatedAt: FieldValue.serverTimestamp() });
    if (user && user.defaultSpaceId === ctx.spaceId) tx.update(userRef, { defaultSpaceId: user.personalSpaceId });
    audit(tx, ctx, 'member.remove', ref.path);
  });
  return { ok: true };
}

export async function setDefaultSpace(uid: string, input: OpData<'user.setDefaultSpace'>) {
  const m = (await memberRef(input.spaceId, uid).get()).data() as MemberDoc | undefined;
  if (m?.status !== 'active') fail('permission-denied', 'No tienes acceso a este espacio.');
  await db.doc(`users/${uid}`).update({ defaultSpaceId: input.spaceId });
  return { ok: true };
}

/** Espacios activos del usuario (para Telegram y el asistente). */
export async function activeSpaces(uid: string) {
  const snap = await db.collectionGroup('members').where('uid', '==', uid).where('status', '==', 'active').get();
  return snap.docs.map((d) => d.data() as MemberDoc);
}
