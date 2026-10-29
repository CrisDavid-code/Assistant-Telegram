import { useEffect, useState, type FormEvent } from 'react';
import { sendEmailVerification, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { Link } from 'react-router-dom';
import { collection, query, where } from 'firebase/firestore';
import { LogOut, Send } from 'lucide-react';
import { ASSIGNABLE_ROLES, CURRENCY_CODES, ROLE_LABELS, type MemberDoc } from '@lifeos/contracts';
import { auth, db } from '../services/firebase';
import { call, newId } from '../services/api';
import { useSpace } from '../hooks/session';
import { useQueryLive } from '../hooks/useLive';
import { Badge, Button, Card, ErrorBox, Field, FormFooter, inputCls, Loading, Modal, PageHeader, useAction } from '../components/ui';

const TIMEZONES = (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['America/Guatemala'];

function SpaceSettings() {
  const { spaceId, space, can } = useSpace();
  const { busy, error, run, clear } = useAction();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    await run(() => call('space.update', spaceId, { name: f.name, timezone: f.timezone, currency: f.currency as never }), 'Espacio actualizado');
  }
  const disabled = !can('space.manage');
  return (
    <Card title={`Espacio: ${space.name}`}>
      <form onSubmit={submit} onChange={clear} className="space-y-3">
        <Field label="Nombre"><input name="name" required maxLength={60} defaultValue={space.name} disabled={disabled} className={inputCls} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Zona horaria"><select name="timezone" defaultValue={space.timezone} disabled={disabled} className={inputCls}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Moneda predeterminada"><select name="currency" defaultValue={space.currency} disabled={disabled} className={inputCls}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select></Field>
        </div>
        {error ? <ErrorBox error={error} /> : null}
        {!disabled && <Button type="submit" busy={busy}>Guardar</Button>}
      </form>
    </Card>
  );
}

function Members() {
  const { spaceId, space, member, can, uid } = useSpace();
  const { busy, error, run, clear } = useAction();
  const members = useQueryLive<MemberDoc>(() => query(collection(db, 'spaces', spaceId, 'members'), where('status', 'in', ['active', 'invited'])), `m:${spaceId}`);
  if (space.type === 'personal') return null;
  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (await run(() => call('member.invite', spaceId, { email: f.email!, role: f.role as never }), 'Invitación enviada')) form.reset();
  }
  return (
    <Card title="Miembros">
      {members.loading ? <Loading /> : members.error ? <ErrorBox error={members.error} /> : (
        <ul className="mb-4 divide-y divide-line">
          {members.data.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <div className="min-w-0 flex-1"><p className="font-medium">{m.displayName}{m.uid === uid && ' (tú)'}</p><p className="text-xs text-ink-soft">{m.email}</p></div>
              {m.status === 'invited' && <Badge tone="warn">Invitado</Badge>}
              {can('members.manage') && m.role !== 'owner' && m.uid !== uid ? (
                <>
                  <select aria-label={`Rol de ${m.displayName}`} value={m.role} onChange={(e) => run(() => call('member.update', spaceId, { uid: m.uid, role: e.target.value as never }), 'Rol actualizado')} className="rounded-full border border-line px-2 py-1 text-sm">
                    {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                  <Button variant="ghost" onClick={() => confirm(`¿Quitar a ${m.displayName}?`) && run(() => call('member.remove', spaceId, { uid: m.uid }), 'Miembro quitado')}>Quitar</Button>
                </>
              ) : <Badge>{ROLE_LABELS[m.role]}</Badge>}
            </li>
          ))}
        </ul>
      )}
      {can('members.manage') && (
        <form onSubmit={invite} onChange={clear} className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input name="email" type="email" required placeholder="correo@ejemplo.com" aria-label="Correo de la persona" className={inputCls} />
          <select name="role" aria-label="Rol" className={inputCls} defaultValue="member">{ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
          <Button type="submit" busy={busy}>Invitar</Button>
        </form>
      )}
      {member?.role !== 'owner' && <Button variant="danger" className="mt-3" onClick={() => confirm('¿Salir de este espacio?') && run(() => call('member.remove', spaceId, { uid }), 'Saliste del espacio')}>Salir del espacio</Button>}
      {error ? <div className="mt-3"><ErrorBox error={error} /></div> : null}
    </Card>
  );
}

function MySpaces() {
  const { memberships, invitations, profile, setSpaceId } = useSpace();
  const [open, setOpen] = useState(false);
  const { busy, error, run, clear } = useAction();
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const r = await run(() => call('space.create', undefined, { requestId: newId(), name: f.name!, timezone: f.timezone!, currency: f.currency as never }), 'Espacio creado');
    if (r) { setOpen(false); setSpaceId(r.spaceId); }
  }
  return (
    <Card title="Mis espacios" action={<Button variant="secondary" onClick={() => setOpen(true)}>Nuevo espacio de empresa</Button>}>
      {invitations.map((i) => (
        <div key={i.id} className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-50 p-3 text-sm">
          <span className="flex-1">Te invitaron a <b>{i.spaceName}</b> como {ROLE_LABELS[i.role]}.</span>
          <Button onClick={() => run(() => call('member.respond', i.spaceId, { accept: true }), 'Invitación aceptada')}>Aceptar</Button>
          <Button variant="secondary" onClick={() => run(() => call('member.respond', i.spaceId, { accept: false }))}>Rechazar</Button>
        </div>
      ))}
      <ul className="divide-y divide-line">
        {memberships.map((m) => (
          <li key={m.spaceId} className="flex items-center gap-2 py-2.5">
            <span className="flex-1">{m.spaceType === 'personal' ? '🏠' : '🏢'} {m.spaceName} <span className="text-xs text-ink-soft">· {ROLE_LABELS[m.role]}</span></span>
            {profile?.defaultSpaceId === m.spaceId ? <Badge tone="brand">Predeterminado</Badge>
              : <Button variant="ghost" onClick={() => run(() => call('user.setDefaultSpace', undefined, { spaceId: m.spaceId }), 'Espacio predeterminado actualizado')}>Hacer predeterminado</Button>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-soft">El espacio predeterminado es el que usa Telegram si no eliges otro con /espacio. Tus finanzas personales nunca se comparten con una empresa.</p>
      {error && !open ? <ErrorBox error={error} /> : null}
      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo espacio de empresa">
        {open && (
          <form onSubmit={create} onChange={clear} className="space-y-3">
            <Field label="Nombre de la empresa"><input name="name" required maxLength={60} className={inputCls} autoFocus /></Field>
            <Field label="Zona horaria"><select name="timezone" defaultValue="America/Guatemala" className={inputCls}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Moneda"><select name="currency" defaultValue="GTQ" className={inputCls}>{CURRENCY_CODES.map((c) => <option key={c}>{c}</option>)}</select></Field>
            <FormFooter busy={busy} error={error} onCancel={() => setOpen(false)} submit="Crear" />
          </form>
        )}
      </Modal>
    </Card>
  );
}

function Telegram() {
  const { profile } = useSpace();
  const [code, setCode] = useState<{ code: string; deepLink: string | null; expiresAt: string } | null>(null);
  const { busy, error, run } = useAction();
  const linked = profile?.telegram;
  useEffect(() => { if (linked) setCode(null); }, [linked]);
  const bot = import.meta.env.VITE_TELEGRAM_BOT_USERNAME;
  return (
    <Card title="Telegram">
      {linked ? (
        <div className="space-y-3 text-sm">
          <p>✅ Vinculado{linked.username ? ` como @${linked.username}` : ''}. Recibirás recordatorios y podrás registrar todo desde el chat.</p>
          <Button variant="danger" busy={busy} onClick={() => confirm('¿Desvincular Telegram? Dejarás de recibir recordatorios.') && run(() => call('telegram.unlink', undefined, {}), 'Telegram desvinculado')}>Desvincular</Button>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p>Vincula el bot para registrar gastos, tareas y recordatorios desde Telegram y recibir avisos.</p>
          {code ? (
            <div className="rounded-xl bg-brand-50 p-4">
              <p>1. Abre {bot ? <a className="font-semibold text-brand-700 underline" href={`https://t.me/${bot}`} target="_blank" rel="noreferrer">@{bot}</a> : 'el bot de Aguiteks LifeOS'} y toca <b>Iniciar</b>.</p>
              <p className="mt-1">2. Envíale este código (vence a las {new Date(code.expiresAt).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}, un solo uso):</p>
              <p className="my-3 text-center font-mono text-2xl font-bold tracking-widest select-all">{code.code}</p>
              {code.deepLink && <a href={code.deepLink} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-600 px-4 font-semibold text-white"><Send className="size-4" />Abrir Telegram y vincular</a>}
            </div>
          ) : (
            <Button busy={busy} onClick={() => run(async () => setCode(await call('telegram.createLinkCode', undefined, {})))}>Generar código</Button>
          )}
        </div>
      )}
      {error ? <div className="mt-3"><ErrorBox error={error} /></div> : null}
    </Card>
  );
}

function Appearance() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('lifeos.theme') ?? 'system'; } catch { return 'system'; } });
  function pick(t: string) {
    setTheme(t);
    try { localStorage.setItem('lifeos.theme', t); } catch { /* sin almacenamiento */ }
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }
  return (
    <Card title="Apariencia">
      <div className="flex gap-2">{[['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) => (
        <Button key={v} variant={theme === v ? 'primary' : 'secondary'} onClick={() => pick(v!)}>{l}</Button>
      ))}</div>
    </Card>
  );
}

function Usage() {
  const { spaceId } = useSpace();
  const [u, setU] = useState<{ month: string; planLabel: string; assistant: { used: number; limit: number }; aiTokens: { input: number; output: number } } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    setU(null);
    call('usage.get', spaceId, {}).then(setU, setErr);
  }, [spaceId]);
  if (err) return <Card title="Plan y uso"><ErrorBox error={err} /></Card>;
  if (!u) return null;
  const pct = Math.min(100, Math.round((u.assistant.used / u.assistant.limit) * 100));
  return (
    <Card title="Plan y uso">
      <p className="text-sm">Plan: <b>{u.planLabel}</b></p>
      <p className="mt-2 text-sm">Mensajes al asistente en {u.month}: {u.assistant.used} de {u.assistant.limit}</p>
      <div className="mt-1 h-2 rounded-full bg-paper" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className={`h-2 rounded-full ${pct >= 90 ? 'bg-danger-700' : 'bg-brand-600'}`} style={{ width: `${pct}%` }} /></div>
    </Card>
  );
}

function AccountData() {
  const { user } = useSpace();
  const [confirmText, setConfirmText] = useState('');
  const { busy, error, run } = useAction();
  async function exportData() {
    await run(async () => {
      const data = await call('account.export', undefined, {});
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `aguiteks-lifeos-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }, 'Exportación descargada');
  }
  async function remove() {
    const ok = await run(() => call('account.delete', undefined, { confirm: confirmText as 'ELIMINAR' }));
    if (ok) await signOut(auth); // el servidor ya borró el usuario; solo se cierra la sesión local
  }
  return (
    <Card title="Mis datos">
      <p className="text-sm text-ink-soft">Descarga una copia de todo lo que guardas en tus espacios (JSON). Los archivos de documentos se descargan uno a uno.</p>
      <Button variant="secondary" className="mt-2" busy={busy} onClick={exportData}>Exportar mis datos</Button>
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold text-danger-700">Eliminar mi cuenta</summary>
        <div className="mt-2 space-y-2 text-sm">
          <p>Se borran tu perfil, tu espacio personal y los espacios de empresa donde eres la única persona; sales de los demás y se desvincula Telegram. No se puede deshacer. Las copias de seguridad que existan expiran según su política.</p>
          <Field label="Escribe ELIMINAR para confirmar"><input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} className={inputCls} autoComplete="off" /></Field>
          <Button variant="danger" busy={busy} disabled={confirmText !== 'ELIMINAR'} onClick={remove}>Eliminar mi cuenta definitivamente</Button>
        </div>
      </details>
      {error ? <div className="mt-3"><ErrorBox error={error} /></div> : null}
    </Card>
  );
}

export default function Settings() {
  const { profile, user } = useSpace();
  const { run } = useAction();
  return (
    <div className="space-y-4">
      <PageHeader title="Configuración" />
      <Card title="Mi cuenta">
        <p className="font-medium">{profile?.displayName}</p>
        <p className="mb-3 text-sm text-ink-soft">{user?.email}</p>
        {user && !user.emailVerified && (
          <p className="mb-3 rounded-xl bg-warn-50 p-3 text-sm text-warn-700">
            Tu correo no está verificado (necesario para invitar personas).{' '}
            <button className="font-semibold underline" onClick={() => run(() => sendEmailVerification(user), 'Te enviamos el correo de verificación. Al confirmarlo, cierra sesión y vuelve a entrar.')}>Enviar verificación</button>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => run(() => sendPasswordResetEmail(auth, user!.email!), 'Te enviamos un correo para cambiar la contraseña')}>Cambiar contraseña</Button>
          <Button variant="secondary" onClick={() => signOut(auth)}><LogOut className="size-4" />Cerrar sesión</Button>
        </div>
      </Card>
      <Telegram />
      <SpaceSettings />
      <Members />
      <Usage />
      <MySpaces />
      <Appearance />
      <AccountData />
      <p className="text-center text-xs"><Link to="/admin" className="text-ink-soft underline">Administración de la plataforma (solo administradores)</Link></p>
    </div>
  );
}
