import { useState, type FormEvent } from 'react';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { Mail, MessageSquare, Pencil, Phone, Plus, Search, Trash2, UserRound } from 'lucide-react';
import { ACTIVITY_TYPES, CONTACT_RELATIONS, type ActivityDoc, type ContactDoc } from '@lifeos/contracts';
import { db } from '../services/firebase';
import { call, newId } from '../services/api';
import { useSpace } from '../hooks/session';
import { useQueryLive } from '../hooks/useLive';
import { Badge, Button, Empty, ErrorBox, Field, FormFooter, inputCls, Loading, Modal, PageHeader, useAction } from '../components/ui';
import { dateTimeLabel } from '../lib/format';

type Contact = ContactDoc & { id: string };
const RELATION: Record<string, string> = { personal: 'Personal', family: 'Familia', client: 'Cliente', prospect: 'Prospecto', supplier: 'Proveedor', work: 'Trabajo', other: 'Otro' };
const ACTIVITY: Record<string, string> = { call: 'Llamada', message: 'Mensaje', meeting: 'Reunión', email: 'Correo', note: 'Nota' };
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const list = (s?: string) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);

function ContactForm({ contact, onClose }: { contact: Contact | null; onClose: () => void }) {
  const { spaceId } = useSpace();
  const { busy, error, run, clear } = useAction();
  const [dups, setDups] = useState(0);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const data = {
      name: f.name!, phones: list(f.phones), emails: list(f.emails), company: f.company || undefined, jobTitle: f.jobTitle || undefined,
      notes: f.notes || undefined, tags: list(f.tags), relation: f.relation as never,
    };
    const r = await run(() => (contact ? call('contact.update', spaceId, { contactId: contact.id, ...data }) : call('contact.create', spaceId, { requestId: newId(), ...data })), 'Contacto guardado');
    if (!r) return;
    // No se combinan duplicados automáticamente: solo se avisa.
    if (r.possibleDuplicates?.length) setDups(r.possibleDuplicates.length);
    else onClose();
  }
  if (dups) return (
    <div className="space-y-4">
      <p className="rounded-xl bg-warn-50 p-3 text-sm text-warn-700">Guardado. Ojo: ya existe{dups > 1 ? 'n' : ''} {dups} contacto(s) con el mismo teléfono o correo. Revisa si es la misma persona.</p>
      <Button onClick={onClose}>Entendido</Button>
    </div>
  );
  return (
    <form onSubmit={submit} onChange={clear} className="space-y-3">
      <Field label="Nombre"><input name="name" required maxLength={80} defaultValue={contact?.name} className={inputCls} autoFocus /></Field>
      <Field label="Teléfonos" hint="Separados por comas"><input name="phones" inputMode="tel" defaultValue={contact?.phones.join(', ')} className={inputCls} /></Field>
      <Field label="Correos" hint="Separados por comas"><input name="emails" defaultValue={contact?.emails.join(', ')} className={inputCls} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Empresa"><input name="company" maxLength={80} defaultValue={contact?.company ?? ''} className={inputCls} /></Field>
        <Field label="Cargo"><input name="jobTitle" maxLength={60} defaultValue={contact?.jobTitle ?? ''} className={inputCls} /></Field>
      </div>
      <Field label="Relación"><select name="relation" defaultValue={contact?.relation ?? 'other'} className={inputCls}>{CONTACT_RELATIONS.map((r) => <option key={r} value={r}>{RELATION[r]}</option>)}</select></Field>
      <Field label="Etiquetas" hint="Separadas por comas"><input name="tags" defaultValue={contact?.tags.join(', ')} className={inputCls} /></Field>
      <Field label="Notas"><textarea name="notes" rows={3} maxLength={2000} defaultValue={contact?.notes ?? ''} className={inputCls} /></Field>
      <FormFooter busy={busy} error={error} onCancel={onClose} />
    </form>
  );
}

function ContactDetail({ contact, onEdit }: { contact: Contact; onEdit: () => void }) {
  const { spaceId, space, can } = useSpace();
  const { busy, error, run, clear } = useAction();
  const acts = useQueryLive<ActivityDoc>(() => query(collection(db, 'spaces', spaceId, 'activities'), where('contactId', '==', contact.id), orderBy('createdAt', 'desc'), limit(30)), `act:${contact.id}`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const ok = await run(() => call('activity.create', spaceId, { requestId: newId(), contactId: contact.id, type: f.type as never, summary: f.summary!, followUpAt: f.followUpAt || undefined }), 'Actividad registrada');
    if (ok) form.reset();
  }
  return (
    <div className="space-y-4">
      <div className="space-y-1 text-sm">
        {contact.company && <p>{contact.jobTitle ? `${contact.jobTitle} · ` : ''}{contact.company}</p>}
        {contact.phones.map((p) => <a key={p} href={`tel:${p}`} className="flex items-center gap-2 text-brand-700"><Phone className="size-4" />{p}</a>)}
        {contact.emails.map((m) => <a key={m} href={`mailto:${m}`} className="flex items-center gap-2 text-brand-700"><Mail className="size-4" />{m}</a>)}
        {contact.notes && <p className="whitespace-pre-line text-ink-soft">{contact.notes}</p>}
      </div>
      {can('core.write') && (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onEdit}><Pencil className="size-4" />Editar</Button>
          <Button variant="danger" onClick={() => confirm(`¿Archivar a ${contact.name}?`) && run(() => call('contact.archive', spaceId, { contactId: contact.id }), 'Contacto archivado')}><Trash2 className="size-4" />Archivar</Button>
        </div>
      )}
      <h3 className="font-semibold">Historial</h3>
      {can('core.write') && (
        <form onSubmit={submit} onChange={clear} className="space-y-2 rounded-xl border border-line p-3">
          <div className="grid grid-cols-2 gap-2">
            <select name="type" className={inputCls} aria-label="Tipo de actividad">{ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{ACTIVITY[t]}</option>)}</select>
            <input name="followUpAt" type="datetime-local" aria-label="Seguimiento (opcional)" title="Recordarme dar seguimiento" className={inputCls} />
          </div>
          <textarea name="summary" required rows={2} maxLength={2000} placeholder="¿Qué pasó? Ej.: Me pidió que lo contacte el jueves." className={inputCls} />
          <p className="text-xs text-ink-soft">Si indicas fecha de seguimiento ({space.timezone}), se crea un recordatorio.</p>
          {error ? <ErrorBox error={error} /> : null}
          <Button type="submit" busy={busy}><MessageSquare className="size-4" />Registrar</Button>
        </form>
      )}
      {acts.loading ? <Loading /> : acts.error ? <ErrorBox error={acts.error} /> : !acts.data.length ? <p className="text-sm text-ink-soft">Sin actividades.</p> : (
        <ul className="space-y-2">
          {acts.data.map((a) => (
            <li key={a.id} className="rounded-xl bg-paper p-3 text-sm">
              <p className="mb-1 flex gap-2 text-xs text-ink-soft"><Badge>{ACTIVITY[a.type]}</Badge>{a.createdAt && dateTimeLabel(a.createdAt.toDate(), space.timezone)}{a.followUpReminderId && <Badge tone="brand">Con seguimiento</Badge>}</p>
              <p className="whitespace-pre-line">{a.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Contacts() {
  const { spaceId, can } = useSpace();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const [selected, setSelected] = useState<Contact | null>(null);
  const contacts = useQueryLive<ContactDoc>(() => query(collection(db, 'spaces', spaceId, 'contacts'), where('archived', '==', false), orderBy('nameLower'), limit(1000)), `c:${spaceId}`);
  const term = norm(q.trim());
  const digits = q.replace(/\D/g, '');
  // ponytail: filtro en el navegador hasta 1000 contactos; búsqueda en servidor si crece.
  const shown = contacts.data.filter((c) => !term || [c.name, c.company ?? '', ...c.emails, ...c.tags].some((f) => norm(f).includes(term)) || (digits.length >= 4 && c.phones.some((p) => p.replace(/\D/g, '').includes(digits))));
  const current = selected && contacts.data.find((c) => c.id === selected.id);

  return (
    <div>
      <PageHeader title="Contactos" action={can('core.write') && <Button onClick={() => setEditing('new')}><Plus className="size-4" />Nuevo</Button>} />
      <label className="relative mb-4 block">
        <span className="sr-only">Buscar contactos</span>
        <Search className="absolute top-3 left-3 size-5 text-ink-soft" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, teléfono, correo, empresa o etiqueta" className={`${inputCls} pl-10`} />
      </label>
      {contacts.loading ? <Loading /> : contacts.error ? <ErrorBox error={contacts.error} /> : !shown.length ? (
        <Empty icon={<UserRound className="size-8" />} text={q ? 'Sin resultados.' : 'Aún no tienes contactos. Agrégalos aquí o compártelos con el bot de Telegram.'} />
      ) : (
        <ul className="divide-y divide-line rounded-[--radius-card] border border-line bg-surface">
          {shown.map((c) => (
            <li key={c.id}>
              <button onClick={() => setSelected(c)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-50 font-bold text-brand-700">{c.name.charAt(0).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block truncate text-xs text-ink-soft">{[c.company, c.phones[0], c.emails[0]].filter(Boolean).join(' · ')}</span>
                </span>
                <Badge>{RELATION[c.relation] ?? c.relation}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!current && !editing} onClose={() => setSelected(null)} title={current?.name ?? ''}>
        {current && !editing && <ContactDetail contact={current} onEdit={() => setEditing(current)} />}
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nuevo contacto' : 'Editar contacto'}>
        {editing && <ContactForm contact={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}
