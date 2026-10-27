import { useEffect, useState } from 'react';
import { onSnapshot, type DocumentReference, type Query } from 'firebase/firestore';

export interface Live<T> { data: T; loading: boolean; error: Error | null }

/** Suscripción en tiempo real a una consulta. `key` cambia → se vuelve a suscribir. */
export function useQueryLive<T>(make: () => Query | null, key: string): Live<(T & { id: string })[]> {
  const [state, set] = useState<Live<(T & { id: string })[]>>({ data: [], loading: true, error: null });
  useEffect(() => {
    const q = make();
    if (!q) return set({ data: [], loading: false, error: null });
    set((s) => ({ ...s, loading: true }));
    return onSnapshot(q, (snap) => set({ data: snap.docs.map((d) => ({ id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as T) })), loading: false, error: null }),
      (error) => set({ data: [], loading: false, error }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export function useDocLive<T>(make: () => DocumentReference | null, key: string): Live<(T & { id: string }) | null> {
  const [state, set] = useState<Live<(T & { id: string }) | null>>({ data: null, loading: true, error: null });
  useEffect(() => {
    const r = make();
    if (!r) return set({ data: null, loading: false, error: null });
    return onSnapshot(r, (d) => set({ data: d.exists() ? { id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as T) } : null, loading: false, error: null }),
      (error) => set({ data: null, loading: false, error }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
