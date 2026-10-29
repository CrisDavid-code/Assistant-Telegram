import { useState, type FormEvent } from 'react';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { FolderKanban, Plus } from 'lucide-react';
import { parseAmount, PROJECT_STATUSES, type ProjectDoc, type TaskDoc } from '@lifeos/contracts';
import { db } from '../services/firebase';
import { call, newId } from '../services/api';
import { useSpace } from '../hooks/session';
import { useQueryLive } from '../hooks/useLive';
import { Badge, Button, Card, Empty, ErrorBox, Field, FormFooter, inputCls, Loading, Modal, PageHeader, Tabs, useAction } from '../components/ui';
import { dayLabel, money, todayIn } from '../lib/format';
import { TaskForm, TaskRow } from './Agenda';

type Project = ProjectDoc & { id: string };
const STATUS: Record<string, [string, 'brand' | 'warn' | 'ok' | 'neutral']> = {
  active: ['Activo', 'brand'], paused: ['En pausa', 'warn'], done: ['Terminado', 'ok'], cancelled: ['Cancelado', 'neutral'],
};

function ProjectForm({ onClose }: { onClose: () => void }) {
  const { spaceId, space } = useSpace();
  const { busy, error, run, clear } = useAction();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const ok = await run(() => call('project.create', spaceId, {
      requestId: newId(), name: f.name!, description: f.description || undefined, dueDate: f.dueDate || undefined,
      budget: f.budget ? (parseAmount(f.budget, space.currency) ?? undefined) : undefined, currency: f.budget ? space.currency : undefined,
    }), 'Proyecto creado');
    if (ok) onClose();
  }
  return (
    <form onSubmit={submit} onChange={clear} className="space-y-3">
      <Field label="Nombre"><input name="name" required maxLength={120} className={inputCls} autoFocus /></Field>
      <Field label="Descripción"><textarea name="description" rows={3} maxLength={4000} className={inputCls} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entrega"><input name="dueDate" type="date" className={inputCls} /></Field>
        <Field label={`Presupuesto (${space.currency})`}><input name="budget" inputMode="decimal" min="0" className={inputCls} /></Field>
      </div>
      <FormFooter busy={busy} error={error} onCancel={onClose} />
    </form>
  );
}

function ProjectDetail({ project }: { project: Project }) {
  const { spaceId, space, can } = useSpace();
  const [adding, setAdding] = useState(false);
  const { error, run } = useAction();
  const tasks = useQueryLive<TaskDoc>(() => query(collection(db, 'spaces', spaceId, 'tasks'), where('projectId', '==', project.id), orderBy('createdAt', 'desc'), limit(200)), `pt:${project.id}`);
  const live = tasks.data.filter((t) => t.status !== 'cancelled');
  const done = live.filter((t) => t.status === 'done').length;
  const pct = live.length ? Math.round((done / live.length) * 100) : 0;
  return (
    <div className="space-y-4">
      {project.description && <p className="text-sm whitespace-pre-line text-ink-soft">{project.description}</p>}
      <div className="flex flex-wrap gap-2 text-sm">
        {project.dueDate && <Badge>Entrega: {dayLabel(project.dueDate, space.timezone)}</Badge>}
        {project.budget && project.currency && <Badge>Presupuesto: {money(project.budget, project.currency)}</Badge>}
      </div>
      <div>
        <p className="mb-1 text-sm">Avance: <b>{pct}%</b> ({done} de {live.length} tareas)</p>
        <div className="h-2 rounded-full bg-paper" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="h-2 rounded-full bg-brand-600" style={{ width: `${pct}%` }} /></div>
      </div>
      {can('core.write') && (
        <label className="block text-sm">Estado{' '}
          <select value={project.status} onChange={(e) => run(() => call('project.update', spaceId, { projectId: project.id, status: e.target.value as never }), 'Estado actualizado')} className="ml-2 rounded-full border border-line px-3 py-1.5">
            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{STATUS[s]![0]}</option>)}
          </select>
        </label>
      )}
      {error ? <ErrorBox error={error} /> : null}
      <div className="flex items-center justify-between"><h3 className="font-semibold">Tareas</h3>{can('core.write') && <Button variant="secondary" onClick={() => setAdding(true)}><Plus className="size-4" />Tarea</Button>}</div>
      {adding && <div className="rounded-xl border border-line p-3"><TaskForm task={null} projectId={project.id} onClose={() => setAdding(false)} /></div>}
      {tasks.loading ? <Loading /> : tasks.error ? <ErrorBox error={tasks.error} /> : !tasks.data.length ? <p className="text-sm text-ink-soft">Sin tareas todavía.</p> : (
        <ul className="divide-y divide-line">{tasks.data.map((t) => <TaskRow key={t.id} task={t} tz={space.timezone} />)}</ul>
      )}
    </div>
  );
}

export default function Projects() {
  const { spaceId, space, can } = useSpace();
  const [show, setShow] = useState<'activos' | 'todos'>('activos');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const list = useQueryLive<ProjectDoc>(() => query(collection(db, 'spaces', spaceId, 'projects'), orderBy('createdAt', 'desc'), limit(200)), `pr:${spaceId}`);
  const shown = list.data.filter((p) => show === 'todos' || p.status === 'active' || p.status === 'paused');
  const current = list.data.find((p) => p.id === open);
  const today = todayIn(space.timezone);
  return (
    <div>
      <PageHeader title="Proyectos" action={can('core.write') && <Button onClick={() => setCreating(true)}><Plus className="size-4" />Nuevo</Button>} />
      <Tabs value={show} onChange={setShow} options={[['activos', 'En curso'], ['todos', 'Todos']]} />
      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : !shown.length ? (
        <Empty icon={<FolderKanban className="size-8" />} text="No hay proyectos. Crea uno para agrupar tareas, fechas y presupuesto." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((p) => (
            <button key={p.id} onClick={() => setOpen(p.id)} className="text-left">
              <Card className="h-full hover:border-brand-600">
                <div className="flex items-start justify-between gap-2"><h2 className="font-bold">{p.name}</h2><Badge tone={STATUS[p.status]![1]}>{STATUS[p.status]![0]}</Badge></div>
                {p.dueDate && <p className={`mt-2 text-sm ${p.dueDate < today && p.status === 'active' ? 'font-semibold text-danger-700' : 'text-ink-soft'}`}>Entrega: {dayLabel(p.dueDate, space.timezone)}</p>}
              </Card>
            </button>
          ))}
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Nuevo proyecto">{creating && <ProjectForm onClose={() => setCreating(false)} />}</Modal>
      <Modal open={!!current} onClose={() => setOpen(null)} title={current?.name ?? ''}>{current && <ProjectDetail project={current} />}</Modal>
    </div>
  );
}
