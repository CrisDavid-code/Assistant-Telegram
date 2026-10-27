import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

const Ctx = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 3500);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 md:bottom-6">
        {msg && <div className="rounded-full bg-night px-4 py-2 text-sm text-white shadow-lg">{msg}</div>}
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
