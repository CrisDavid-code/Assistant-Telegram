import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Bot, CalendarCheck, Home, Settings, Users, Wallet, WifiOff } from 'lucide-react';
import { useSession } from '../hooks/session';

function useOnline() {
  const [on, set] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => set(true);
    const down = () => set(false);
    addEventListener('online', up);
    addEventListener('offline', down);
    return () => { removeEventListener('online', up); removeEventListener('offline', down); };
  }, []);
  return on;
}

export function AppLayout() {
  const s = useSession();
  const online = useOnline();
  const nav = useNavigate();
  // Solo se muestran destinos que existen y que el rol puede usar.
  const items = [
    { to: '/', label: 'Inicio', icon: Home, end: true },
    { to: '/agenda', label: 'Agenda', icon: CalendarCheck },
    ...(s.can('finance.read') ? [{ to: '/finanzas', label: 'Finanzas', icon: Wallet }] : []),
    { to: '/contactos', label: 'Contactos', icon: Users },
    { to: '/asistente', label: 'Asistente', icon: Bot },
  ];
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? 'text-brand-700' : 'text-ink-soft');

  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface p-4 md:block">
        <p className="mb-6 px-2 text-lg font-bold text-brand-700">Aguiteks LifeOS</p>
        <nav aria-label="Principal" className="space-y-1">
          {[...items, { to: '/configuracion', label: 'Configuración', icon: Settings }].map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:bg-paper'}`}>
              <Icon className="size-5" aria-hidden />{label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface px-4 py-2">
          <label className="sr-only" htmlFor="space">Espacio</label>
          <select id="space" value={s.spaceId ?? ''} onChange={(e) => s.setSpaceId(e.target.value)}
            className="min-h-11 max-w-[70%] rounded-full border border-line px-3 text-sm font-semibold">
            {s.memberships.map((m) => <option key={m.spaceId} value={m.spaceId}>{m.spaceType === 'personal' ? '🏠' : '🏢'} {m.spaceName}</option>)}
          </select>
          <div className="flex-1" />
          <button aria-label="Configuración" onClick={() => nav('/configuracion')} className="grid size-11 place-items-center rounded-full text-ink-soft hover:bg-paper md:hidden">
            <Settings className="size-5" />
          </button>
        </header>
        {!online && (
          <p role="status" className="flex items-center gap-2 bg-warn-50 px-4 py-2 text-sm text-warn-700">
            <WifiOff className="size-4" aria-hidden /> Sin conexión. Para ver datos actualizados o guardar cambios necesitas internet.
          </p>
        )}
        {s.invitations.length > 0 && (
          <button onClick={() => nav('/configuracion')} className="block w-full bg-brand-50 px-4 py-2 text-left text-sm text-brand-700">
            Tienes {s.invitations.length} invitación(es) a espacios de empresa. Toca para responder.
          </button>
        )}
        <main className="mx-auto max-w-4xl p-4 pb-28 md:pb-8">
          <Outlet />
        </main>
      </div>

      <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={(a) => `flex min-h-14 min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${link(a)}`}>
            <Icon className="size-5" aria-hidden />{label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
