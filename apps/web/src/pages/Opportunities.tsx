import { useState, type FormEvent } from 'react';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { Handshake, Plus } from 'lucide-react';
import { OPPORTUNITY_STAGES, parseAmount, type ContactDoc, type OpportunityDoc } from '@lifeos/contracts';
import { db } from '../services/firebase';
import { call, newId } from '../services/api';
import { useSpace } from '../hooks/session';
import { useQueryLive } from '../hooks/useLive';
import { Badge, Button, Empty, ErrorBox, Field, FormFooter, inputCls, Loading, Modal, PageHeader, useAction } from '../components/ui';
import { dayLabel, money, todayIn } from '../lib/format';

type Opp = OpportunityDoc & { id: string };
const STAGE: Record<string, string> = { lead: 'Prospecto', contacted: 'Contactado', proposal: 'Propuesta', negotiation: 'Negociación', won: 'Ganada', lost: 'Perdida' };

function OpportunityForm({ onClose }: { onClose: () => void }) {
  const { spaceId, space } = useSpace();
  const { busy, error, run, clear } = useAction();
  const contacts = useQueryLive<ContactDoc>(() => query(collection(db, 'spaces', spaceId, 'contacts'), where('archived', '==', false), orderBy('nameLower'), limit(500)), `oc:${spaceId}`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const ok = await run(async () => {
      const amount = f.amount ? parseAmount(f.amount, space.currency) : undefined;
      if (f.amount && !amount) throw new Error('Monto inválido.');
      return call('opportunity.create', spaceId, {
        requestId: newId(), title: f.title!, contactId: f.contactId || undefined, amount: amount ?? undefined, currency: amount ? space.currency : undefined,
        expectedClose: f.expectedClose || undefined, nextAction: f.nextAction || undefined, notes: f.notes || undefined,
      });
    }, 'Oportunidad creada');
    if (ok) onClose();
  }
  return (
    <form onSubmit={submit} onChange={clear} className="space-y-3">
      <Field label="Oportunidad"><input name="title" required maxLength={120} placeholder="Ej.: Página web para Ferretería López" className={inputCls} autoFocus /></Field>
      <Field label="Contacto"><select name="contactId" defaultValue="" className={inputCls}><option value="">Sin contacto</option>{contacts.data.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ''}</option>)}</select></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Monto (${space.currency})`}><input name="amount" inputMode="decimal" className={inputCls} /></Field>
        <Field label="Cierre esperado"><input name="expectedClose" type="date" className={inputCls} /></Field>
      </div>
      <Field label="Próxima acción"><input name="nextAction" maxLength={200} placeholder="Ej.: Enviar propuesta el jueves" className={inputCls} /></Field>
      <Field label="Notas"><textarea name="notes" rows={3} maxLength={2000} className={inputCls} /></Field>
      <FormFooter busy={busy} error={error} onCancel={onClose} />
    </form>
  );
}

function OppCard({ o, contact }: { o: Opp; contact?: string }) {
  const { spaceId, space, can } = useSpace();
  const { error, run } = useAction();
  const today = todayIn(space.timezone);
  async function move(stage: string) {
    let createReceivable = false;
    if (stage === 'won' && o.amount && !o.obligationId && can('finance.write')) {
      createReceivable = confirm(`¿Registrar el cobro esperado de ${money(o.amount, o.currency!)}? Aparecerá en Pagos y cobros; no cuenta como ingreso hasta que lo cobres.`);
    }
    await run(() => call('opportunity.setStage', spaceId, { opportunityId: o.id, stage: stage as never, createReceivable }), `Movida a ${STAGE[stage]}`);
  }
  return (
    <li className="rounded-xl border border-line bg-surface p-3 text-sm">
      <p className="font-semibold">{o.title}</p>
      <p className="text-xs text-ink-soft">{[contact, o.amount && o.currency ? money(o.amount, o.currency) : null].filter(Boolean).join(' · ')}</p>
      {o.nextAction && <p className="mt-1">➡️ {o.nextAction}</p>}
      {o.expectedClose && <p className={`text-xs ${o.expectedClose < today && !['won', 'lost'].includes(o.stage) ? 'text-danger-700' : 'text-ink-soft'}`}>Cierre: {dayLabel(o.expectedClose, space.timezone)}</p>}
      {o.obligationId && <Badge tone="ok">Cobro registrado</Badge>}
      {can('core.write') && (
        <label className="mt-2 block text-xs">Etapa{' '}
          <select value={o.stage} onChange={(e) => move(e.target.value)} className="ml-1 rounded-full border border-line px-2 py-1">
            {OPPORTUNITY_STAGES.map((s) => <option key={s} value={s}>{STAGE[s]}</option>)}
          </select>
        </label>
      )}
      {error ? <ErrorBox error={error} /> : null}
    </li>
  );
}

export default function Opportunities() {
  const { spaceId, can } = useSpace();
  const [creating, setCreating] = useState(false);
  const list = useQueryLive<OpportunityDoc>(() => query(collection(db, 'spaces', spaceId, 'opportunities'), orderBy('updatedAt', 'desc'), limit(300)), `opp:${spaceId}`);
  const contacts = useQueryLive<ContactDoc>(() => query(collection(db, 'spaces', spaceId, 'contacts'), where('archived', '==', false), orderBy('nameLower'), limit(1000)), `oppc:${spaceId}`);
  const name = (id: string | null) => contacts.data.find((c) => c.id === id)?.name;
  const open = list.data.filter((o) => !['won', 'lost'].includes(o.stage));
  // Totales por moneda de lo abierto (sin mezclar monedas).
  const pipeline: Record<string, number> = {};
  open.forEach((o) => o.amount && o.currency && (pipeline[o.currency] = (pipeline[o.currency] ?? 0) + o.amount));
  return (
    <div>
      <PageHeader title="Oportunidades" action={can('core.write') && <Button onClick={() => setCreating(true)}><Plus className="size-4" />Nueva</Button>} />
      {Object.entries(pipeline).map(([c, v]) => <p key={c} className="mb-3 text-sm text-ink-soft">En negociación: <b className="text-ink">{money(v, c)}</b> ({open.length} abiertas)</p>)}
      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : !list.data.length ? (
        <Empty icon={<Handshake className="size-8" />} text="Registra prospectos y clientes potenciales y muévelos por etapas hasta cerrar la venta." />
      ) : (
        <div className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2">
          {OPPORTUNITY_STAGES.map((s) => {
            const items = list.data.filter((o) => o.stage === s);
            return (
              <section key={s} className="w-64 shrink-0 snap-start" aria-label={STAGE[s]}>
                <h2 className="mb-2 text-sm font-bold">{STAGE[s]} <span className="text-ink-soft">({items.length})</span></h2>
                <ul className="space-y-2">{items.map((o) => <OppCard key={o.id} o={o} contact={name(o.contactId)} />)}</ul>
              </section>
            );
          })}
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Nueva oportunidad">{creating && <OpportunityForm onClose={() => setCreating(false)} />}</Modal>
    </div>
  );
}
