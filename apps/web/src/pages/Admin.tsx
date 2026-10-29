import { useEffect, useState, type FormEvent } from 'react';
import { call } from '../services/api';
import { Button, Card, ErrorBox, Field, inputCls, Loading, PageHeader, useAction } from '../components/ui';

interface Stats {
  month: string; users: number; spaces: number; businessSpaces: number; telegramLinked: number;
  reminders: { scheduled: number; failed: number; undeliverable: number };
  assistantMessages: number; aiTokens: { input: number; output: number };
}

/** Solo para administradores de la plataforma (ADMIN_UIDS en el Worker); el backend lo verifica. */
export default function Admin() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const { busy, error, run } = useAction();
  useEffect(() => {
    call('admin.stats', undefined, {}).then(setStats, setErr);
  }, []);
  async function setPlan(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    await run(() => call('admin.setPlan', undefined, { spaceId: f.spaceId!.trim(), plan: f.plan as never }), 'Plan actualizado');
  }
  if (err) return <div><PageHeader title="Administración" /><ErrorBox error={err} /></div>;
  if (!stats) return <Loading />;
  const kpi = (label: string, value: number | string) => (
    <div className="rounded-xl border border-line bg-surface p-3"><p className="text-xs text-ink-soft">{label}</p><p className="text-xl font-bold">{value}</p></div>
  );
  return (
    <div className="space-y-4">
      <PageHeader title="Administración" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpi('Usuarios', stats.users)}
        {kpi('Espacios', `${stats.spaces} (${stats.businessSpaces} empresa)`)}
        {kpi('Telegram vinculado', stats.telegramLinked)}
        {kpi(`Mensajes al asistente (${stats.month})`, stats.assistantMessages)}
        {kpi('Recordatorios programados', stats.reminders.scheduled)}
        {kpi('Recordatorios fallidos', stats.reminders.failed)}
        {kpi('Sin canal (sin Telegram)', stats.reminders.undeliverable)}
        {kpi('Tokens de IA (entrada/salida)', `${stats.aiTokens.input} / ${stats.aiTokens.output}`)}
      </div>
      <Card title="Cambiar plan de un espacio">
        <form onSubmit={setPlan} className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Field label="ID del espacio"><input name="spaceId" required className={inputCls} /></Field>
          <Field label="Plan"><select name="plan" className={inputCls}><option value="free">Gratis</option><option value="premium">Personal Premium</option><option value="business">Empresa</option></select></Field>
          <div className="self-end"><Button type="submit" busy={busy}>Guardar</Button></div>
        </form>
        <p className="mt-2 text-xs text-ink-soft">No hay cobros integrados: el plan se asigna manualmente hasta elegir proveedor de pagos.</p>
        {error ? <div className="mt-2"><ErrorBox error={error} /></div> : null}
      </Card>
    </div>
  );
}
