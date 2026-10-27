import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { errorMessage } from '../services/api';
import { useToast } from '../hooks/useToast';

const VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'border border-line bg-surface text-ink hover:bg-paper',
  ghost: 'text-ink-soft hover:bg-paper',
  danger: 'bg-danger-50 text-danger-700 hover:brightness-95',
};

export function Button({ variant = 'primary', busy, className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANTS; busy?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || busy}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition active:scale-[0.97] disabled:opacity-50 ${VARIANTS[variant]} ${className}`}>
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export const inputCls = 'w-full rounded-xl border border-line px-3 py-2.5 text-base outline-none focus:border-brand-600';

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink-soft">{hint}</span>}
    </label>
  );
}

export function Card({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[--radius-card] border border-line bg-surface p-4 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="font-bold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {action}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div role="tablist" className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
      {options.map(([v, label]) => (
        <button key={v} role="tab" aria-selected={v === value} onClick={() => onChange(v)}
          className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${v === value ? 'bg-ink text-surface' : 'border border-line bg-surface text-ink-soft'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

export const Loading = () => (
  <div className="flex justify-center py-10 text-ink-soft" role="status"><Loader2 className="size-6 animate-spin" /><span className="sr-only">Cargando…</span></div>
);

export const Empty = ({ icon, text, action }: { icon?: ReactNode; text: string; action?: ReactNode }) => (
  <div className="flex flex-col items-center gap-3 py-8 text-center text-sm text-ink-soft">{icon}<p>{text}</p>{action}</div>
);

export const ErrorBox = ({ error }: { error: unknown }) => (
  <p role="alert" className="rounded-xl bg-danger-50 p-3 text-sm text-danger-700">{errorMessage(error)}</p>
);

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'brand'; children: ReactNode }) {
  const c = { neutral: 'bg-paper text-ink-soft', ok: 'bg-ok-50 text-ok-700', warn: 'bg-warn-50 text-warn-700', danger: 'bg-danger-50 text-danger-700', brand: 'bg-brand-50 text-brand-700' }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{children}</span>;
}

/** Diálogo nativo: foco atrapado, Escape cierra. */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-label={title}
      className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink">
      {open && (
        <div className="max-h-[85dvh] overflow-y-auto p-5">
          <h2 className="mb-4 text-lg font-bold">{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}

/**
 * Ejecuta una acción del backend con estado de carga y error. El éxito solo se anuncia
 * cuando el servidor confirma (nada de éxito optimista).
 */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, clear: () => setError(null) };
}

/** Pie de formulario: error + botones. */
export function FormFooter({ busy, error, onCancel, submit = 'Guardar' }: { busy: boolean; error: unknown; onCancel: () => void; submit?: string }) {
  return (
    <div className="mt-5 space-y-3">
      {error ? <ErrorBox error={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" busy={busy}>{submit}</Button>
      </div>
    </div>
  );
}
