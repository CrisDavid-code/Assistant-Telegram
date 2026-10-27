import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collectionGroup, doc, query, where } from 'firebase/firestore';
import { can, type MemberDoc, type Permission, type SpaceDoc, type UserDoc } from '@lifeos/contracts';
import { auth, db } from '../services/firebase';
import { call } from '../services/api';
import { useDocLive, useQueryLive } from './useLive';

interface Session {
  user: User | null;
  ready: boolean;
  profile: (UserDoc & { id: string }) | null;
  memberships: (MemberDoc & { id: string })[]; // activas
  invitations: (MemberDoc & { id: string })[];
  spaceId: string | null;
  space: (SpaceDoc & { id: string }) | null;
  member: (MemberDoc & { id: string }) | null;
  setSpaceId: (id: string) => void;
  can: (p: Permission) => boolean;
}

const Ctx = createContext<Session | null>(null);

/** Durante el registro, Login crea el perfil con el nombre; la sesión no se adelanta con uno vacío. */
export const registering = { active: false };
export const bootstrap = (displayName?: string) =>
  call('user.bootstrap', undefined, { displayName, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
const SPACE_KEY = 'lifeos.space';
const readStored = () => { try { return localStorage.getItem(SPACE_KEY); } catch { return null; } };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [chosen, setChosen] = useState<string | null>(readStored);
  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setAuthReady(true); }), []);

  const uid = user?.uid ?? '';
  const profile = useDocLive<UserDoc>(() => (uid ? doc(db, 'users', uid) : null), uid);
  const mems = useQueryLive<MemberDoc>(() => (uid ? query(collectionGroup(db, 'members'), where('uid', '==', uid)) : null), uid);

  // Primera vez: el backend crea el perfil y el espacio personal (idempotente).
  useEffect(() => {
    if (uid && !profile.loading && !profile.data && !profile.error && !registering.active) {
      bootstrap(user?.displayName ?? undefined).catch(console.error);
    }
  }, [uid, profile.loading, profile.data, profile.error]);

  const memberships = mems.data.filter((m) => m.status === 'active');
  const invitations = mems.data.filter((m) => m.status === 'invited');
  const valid = (id: string | null) => !!id && memberships.some((m) => m.spaceId === id);
  const spaceId = valid(chosen) ? chosen : valid(profile.data?.defaultSpaceId ?? null) ? profile.data!.defaultSpaceId : (profile.data?.personalSpaceId ?? null);
  const space = useDocLive<SpaceDoc>(() => (spaceId && valid(spaceId) ? doc(db, 'spaces', spaceId) : null), `${spaceId}:${valid(spaceId)}`);
  const member = memberships.find((m) => m.spaceId === spaceId) ?? null;

  const value = useMemo<Session>(() => ({
    user, profile: profile.data, memberships, invitations, spaceId, space: space.data, member,
    ready: authReady && (!user || (!!profile.data && !mems.loading && !!space.data)),
    setSpaceId: (id) => { try { localStorage.setItem(SPACE_KEY, id); } catch { /* sin almacenamiento */ } setChosen(id); },
    can: (p) => can(member?.role, p),
  }), [user, authReady, profile.data, mems.data, mems.loading, space.data, spaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession fuera de SessionProvider');
  return s;
}

/** Espacio garantizado (solo dentro de rutas protegidas). */
export function useSpace() {
  const s = useSession();
  return { ...s, spaceId: s.spaceId!, space: s.space!, uid: s.user!.uid };
}
