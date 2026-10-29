import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { Bell, CalendarClock, Check, ChevronLeft, ChevronRight, Pencil, Plus, Repeat, RotateCcw, X } from 'lucide-react';
import { TASK_PRIORITIES, type ProjectDoc, type ReminderDoc, type TaskDoc } from '@lifeos/contracts';
import { db } from '../services/firebase';
import { call, newId } from '../services/api';
import { useSpace } from '../hooks/session';
import { useQueryLive } from '../hooks/useLive';
import { Badge, Button, Empty, ErrorBox, Field, FormFooter, inputCls, Loading, Modal, PageHeader, Tabs, useAction } from '../components/ui';
import { addDays, dateTimeLabel, dayLabel, localInput, todayIn } from '../lib/format';

const PRIORITY: Record<string, [string, 'neutral' | 'brand' | 'warn' | 'danger']> = {
  low: ['Baja', 'neutral'], normal: ['Normal', 'brand'], high: ['Alta', 'warn'], urgent: ['Urgente', 'danger'],
};
const REM_STATUS: Record<string, [string, 'neutral' | 'ok' | 'warn' | 'danger' | 'brand']> = {
  scheduled: ['Programado', 'brand'], sending: ['Enviando', 'brand'], delivered: ['Enviado', 'ok'],
  undeliverable: ['Sin canal (vincula Telegram)', 'warn'], failed: ['Falló el envío', 'danger'], cancelled: ['Cancelado', 'neutral'],
};

type Task = TaskDoc & { id: string };
type View = 'hoy' | 'proximos' | 'atrasadas' | 'sinfecha' | 'completadas' | 'recordatorios' | 'mes';

export function TaskRow({ task, tz, onEdit }: { task: Task; tz: string; onEdit?: (t: Task) => void }) {
  const { spaceId, can } = useSpace();
  const { busy, error, run } = useAction();
  const done = task.status === 'done';
  const overdue = !done && task.dueDate && task.dueDate < todayIn(tz);
  const set = (status: 'open' | 'done' | 'cancelled') => run(() => call('task.setStatus', spaceId, { taskId: task.id, status }), status === 'done' ? 'Tarea completada' : undefined);
  return (
    <li className="flex items-start gap-3 py-2.5">
      <button aria-label={done ? 'Marcar como pendiente' : 'Completar tarea'} disabled={busy || !can('core.write')} onClick={() => set(done ? 'open' : 'done')}
        className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 ${done ? 'border-ok-700 bg-ok-700 text-white' : 'border-line hover:border-brand-600'}`}>
        {done && <Check className="size-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`font-medium ${done ? 'text-ink-soft line-through' : ''}`}>{task.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
          {task.dueDate && <span className={overdue ? 'font-semibold text-danger-700' : ''}>{dayLabel(task.dueDate, tz)}{task.dueTime ? ` · ${task.dueTime}` : ''}{overdue ? ' (atrasada)' : ''}</span>}
          {task.priority !== 'normal' && <Badge tone={PRIORITY[task.priority]![1]}>{PRIORITY[task.priority]![0]}</Badge>}
          {task.tags.map((t) => <Badge key={t}>#{t}</Badge>)}
          {task.recurrence && <Badge><Repeat className="mr-1 size-3" aria-hidden />Se repite</Badge>}
          {task.source === 'telegram' && <Badge>Telegram</Badge>}
        </div>
        {task.notes && <p className="mt-1 text-sm text-ink-soft">{task.notes}</p>}
        {error ? <ErrorBox error={error} /> : null}
      </div>
      {onEdit && can('core.write') && !done && (
        <div className="flex">
          <button aria-label="Editar" onClick={() => onEdit(task)} className="grid size-9 place-items-center rounded-full text-ink-soft hover:bg-paper"><Pencil className="size-4" /></button>
          <button aria-label="Cancelar tarea" onClick={() => confirm('¿Cancelar esta tarea?') && set('cancelled')} className="grid size-9 place-items-center rounded-full text-ink-soft hover:bg-paper"><X className="size-4" /></button>
        </div>
      )}
    </li>
  );
}

export function TaskForm({ task, onClose, projectId }: { task: Task | null; onClose: () => void; projectId?: string }) {
  const { spaceId } = useSpace();
  const projects = useQueryLive<ProjectDoc>(() => (projectId ? null : query(collection(db, 'spaces', spaceId, 'projects'), where('status', '==', 'active'), limit(100))), `tfp:${spaceId}:${projectId}`);
  const { busy, error, run, clear } = useAction();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const tags = f.tags ? f.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const ok = await run(() => task
      ? call('task.update', spaceId, { taskId: task.id, title: f.title!, notes: f.notes ?? '', dueDate: f.dueDate || null, dueTime: f.dueTime || null, priority: f.priority as never, tags, projectId: projectId ?? (f.projectId || null) })
      : call('task.create', spaceId, {
          requestId: newId(), title: f.title!, notes: f.notes || undefined, dueDate: f.dueDate || undefined, dueTime: f.dueTime || undefined, priority: f.priority as never, tags,
          projectId: projectId ?? (f.projectId || undefined), recurrence: f.freq ? { freq: f.freq as never, interval: 1 } : undefined,
        }),
    task ? 'Tarea actualizada' : 'Tarea creada');
    if (ok) onClose();
  }
  return (
    <form onSubmit={submit} onChange={clear} className="space-y-3">
      <Field label="Título"><input name="title" required maxLength={200} defaultValue={task?.title} className={inputCls} autoFocus /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fecha"><input name="dueDate" type="date" defaultValue={task?.dueDate ?? ''} className={inputCls} /></Field>
        <Field label="Hora (opcional)"><input name="dueTime" type="time" defaultValue={task?.dueTime ?? ''} className={inputCls} /></Field>
      </div>
      <Field label="Prioridad">
        <select name="priority" defaultValue={task?.priority ?? 'normal'} className={inputCls}>
          {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY[p]![0]}</option>)}
        </select>
      </Field>
      {!projectId && projects.data.length > 0 && (
        <Field label="Proyecto">
          <select name="projectId" defaultValue={task?.projectId ?? ''} className={inputCls}>
            <option value="">Sin proyecto</option>
            {projects.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}
      {!task && (
        <Field label="Repetir" hint="Al completarla se crea la siguiente. Requiere fecha.">
          <select name="freq" className={inputCls} defaultValue="">
            <option value="">No repetir</option><option value="daily">Cada día</option><option value="weekly">Cada semana</option>
            <option value="monthly">Cada mes</option><option value="yearly">Cada año</option>
          </select>
        </Field>
      )}
      <Field label="Etiquetas" hint="Separadas por comas"><input name="tags" defaultValue={task?.tags.join(', ')} className={inputCls} /></Field>
      <Field label="Notas"><textarea name="notes" rows={3} maxLength={4000} defaultValue={task?.notes ?? ''} className={inputCls} /></Field>
      <FormFooter busy={busy} error={error} onCancel={onClose} />
    </form>
  );
}

function ReminderForm({ reminder, onClose }: { reminder: (ReminderDoc & { id: string }) | null; onClose: () => void }) {
  const { spaceId, space } = useSpace();
  const { busy, error, run, clear } = useAction();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const ok = await run(() => reminder
      ? call('reminder.reschedule', spaceId, { reminderId: reminder.id, at: f.at! })
      : call('reminder.create', spaceId, { requestId: newId(), title: f.title!, at: f.at!, recurrence: f.freq ? { freq: f.freq as never, interval: 1 } : undefined }),
    reminder ? 'Recordatorio reprogramado' : 'Recordatorio programado');
    if (ok) onClose();
  }
  return (
    <form onSubmit={submit} onChange={clear} className="space-y-3">
      {!reminder && <Field label="¿Qué te recuerdo?"><input name="title" required maxLength={200} className={inputCls} autoFocus /></Field>}
      <Field label="Fecha y hora" hint={`Zona horaria: ${space.timezone}`}>
        <input name="at" type="datetime-local" required className={inputCls} defaultValue={reminder ? localInput(reminder.scheduledFor.toDate(), space.timezone) : ''} />
      </Field>
      {!reminder && (
        <Field label="Repetir">
          <select name="freq" className={inputCls} defaultValue="">
            <option value="">No repetir</option><option value="daily">Cada día</option><option value="weekly">Cada semana</option>
            <option value="monthly">Cada mes</option><option value="yearly">Cada año</option>
          </select>
        </Field>
      )}
      <p className="text-xs text-ink-soft">Los recordatorios llegan por Telegram si lo tienes vinculado.</p>
      <FormFooter busy={busy} error={error} onCancel={onClose} submit={reminder ? 'Reprogramar' : 'Programar'} />
    </form>
  );
}

function Reminders() {
  const { spaceId, space, can } = useSpace();
  const [edit, setEdit] = useState<(ReminderDoc & { id: string }) | null>(null);
  const { error, run } = useAction();
  const list = useQueryLive<ReminderDoc>(() => query(collection(db, 'spaces', spaceId, 'reminders'), orderBy('scheduledFor', 'desc'), limit(100)), `rem:${spaceId}`);
  if (list.loading) return <Loading />;
  if (list.error) return <ErrorBox error={list.error} />;
  if (!list.data.length) return <Empty icon={<Bell className="size-8" />} text="No tienes recordatorios. Crea uno aquí o pídeselo al bot de Telegram." />;
  return (
    <>
      {error ? <ErrorBox error={error} /> : null}
      <ul className="divide-y divide-line rounded-[--radius-card] border border-line bg-surface px-4">
        {list.data.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-3">
            <Bell className="size-5 shrink-0 text-brand-600" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{r.title}</p>
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                {dateTimeLabel(r.scheduledFor.toDate(), space.timezone)}
                <Badge tone={REM_STATUS[r.status]![1]}>{REM_STATUS[r.status]![0]}</Badge>
                {r.recurrence && <Badge>Se repite</Badge>}
                {r.lastError && r.status !== 'delivered' && <span title={r.lastError}>· {r.attempts} intento(s)</span>}
              </p>
            </div>
            {can('core.write') && r.status !== 'cancelled' && (
              <>
                <button aria-label="Reprogramar" onClick={() => setEdit(r)} className="grid size-9 place-items-center rounded-full text-ink-soft hover:bg-paper"><CalendarClock className="size-4" /></button>
                {['scheduled', 'undeliverable', 'failed'].includes(r.status) && (
                  <button aria-label="Cancelar recordatorio" onClick={() => confirm('¿Cancelar este recordatorio?') && run(() => call('reminder.cancel', spaceId, { reminderId: r.id }), 'Recordatorio cancelado')}
                    className="grid size-9 place-items-center rounded-full text-ink-soft hover:bg-paper"><X className="size-4" /></button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Reprogramar recordatorio">
        {edit && <ReminderForm reminder={edit} onClose={() => setEdit(null)} />}
      </Modal>
    </>
  );
}

/** Calendario del mes con tareas abiertas y recordatorios programados; al tocar un día se listan. */
function MonthCalendar({ tasks, onEdit }: { tasks: Task[]; onEdit: (t: Task) => void }) {
  const { spaceId, space } = useSpace();
  const tz = space.timezone;
  const today = todayIn(tz);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const reminders = useQueryLive<ReminderDoc>(() => query(collection(db, 'spaces', spaceId, 'reminders'), where('status', '==', 'scheduled'), orderBy('scheduledFor'), limit(300)), `cal:${spaceId}`);
  const first = new Date(`${month}-01T12:00:00Z`);
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // semana inicia el lunes
  const iso = (d: number) => `${month}-${String(d).padStart(2, '0')}`;
  const remDay = (r: ReminderDoc) => localInput(r.scheduledFor.toDate(), tz).slice(0, 10);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const dayTasks = tasks.filter((t) => t.dueDate === selected);
  const dayRems = reminders.data.filter((r) => remDay(r) === selected);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button aria-label="Mes anterior" onClick={() => shift(-1)} className="grid size-11 place-items-center rounded-full hover:bg-paper"><ChevronLeft /></button>
        <h2 className="font-bold first-letter:uppercase">{new Intl.DateTimeFormat('es-GT', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)}</h2>
        <button aria-label="Mes siguiente" onClick={() => shift(1)} className="grid size-11 place-items-center rounded-full hover:bg-paper"><ChevronRight /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs" role="grid">
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => <div key={i} className="py-1 font-semibold text-ink-soft">{d}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = iso(i + 1);
          const nT = tasks.filter((t) => t.dueDate === d).length;
          const nR = reminders.data.filter((r) => remDay(r) === d).length;
          return (
            <button key={d} onClick={() => setSelected(d)} aria-label={`${i + 1}: ${nT} tareas, ${nR} recordatorios`} aria-pressed={d === selected}
              className={`flex min-h-12 flex-col items-center justify-start rounded-lg border p-1 ${d === selected ? 'border-brand-600 bg-brand-50' : 'border-line bg-surface'} ${d === today ? 'font-bold text-brand-700' : ''}`}>
              {i + 1}
              <span className="mt-0.5 flex gap-0.5">
                {nT > 0 && <span className={`size-1.5 rounded-full ${d < today ? 'bg-danger-700' : 'bg-brand-600'}`} />}
                {nR > 0 && <span className="size-1.5 rounded-full bg-warn-700" />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="rounded-[--radius-card] border border-line bg-surface px-4 py-2">
        <h3 className="py-2 font-semibold">{dayLabel(selected, tz)}</h3>
        {reminders.error ? <ErrorBox error={reminders.error} /> : null}
        {!dayTasks.length && !dayRems.length && <p className="pb-3 text-sm text-ink-soft">Nada para este día.</p>}
        <ul className="divide-y divide-line">
          {dayRems.map((r) => <li key={r.id} className="flex items-center gap-2 py-2.5 text-sm"><Bell className="size-4 text-warn-700" />{r.title}<span className="ml-auto text-ink-soft">{localInput(r.scheduledFor.toDate(), tz).slice(11)}</span></li>)}
          {dayTasks.map((t) => <TaskRow key={t.id} task={t} tz={tz} onEdit={onEdit} />)}
        </ul>
      </div>
    </div>
  );
}

export default function Agenda() {
  const { spaceId, space, can } = useSpace();
  const [params, setParams] = useSearchParams();
  const view = (params.get('vista') as View) || 'hoy';
  const creating = params.get('nuevo');
  const [edit, setEdit] = useState<Task | null>(null);
  const tz = space.timezone;
  const today = todayIn(tz);
  const col = collection(db, 'spaces', spaceId, 'tasks');
  const open = useQueryLive<TaskDoc>(() => query(col, where('status', '==', 'open'), orderBy('createdAt', 'desc'), limit(300)), `open:${spaceId}`);
  const done = useQueryLive<TaskDoc>(() => (view === 'completadas' ? query(col, where('status', '==', 'done'), orderBy('createdAt', 'desc'), limit(50)) : null), `done:${spaceId}:${view}`);

  const byDue = (a: Task, b: Task) => `${a.dueDate}${a.dueTime ?? '99'}`.localeCompare(`${b.dueDate}${b.dueTime ?? '99'}`);
  const views: Record<Exclude<View, 'recordatorios' | 'mes'>, Task[]> = {
    hoy: open.data.filter((t) => t.dueDate && t.dueDate <= today).sort(byDue),
    proximos: open.data.filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= addDays(today, 30)).sort(byDue),
    atrasadas: open.data.filter((t) => t.dueDate && t.dueDate < today).sort(byDue),
    sinfecha: open.data.filter((t) => !t.dueDate),
    completadas: done.data,
  };
  const setView = (v: View) => setParams({ vista: v });
  const close = () => setParams(view === 'hoy' ? {} : { vista: view });
  const state = view === 'completadas' ? done : open;
  const list = view === 'recordatorios' || view === 'mes' ? [] : views[view];

  return (
    <div>
      <PageHeader title="Agenda" action={can('core.write') && (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setParams({ vista: view, nuevo: 'recordatorio' })}><Bell className="size-4" /><span className="hidden sm:inline">Recordatorio</span></Button>
          <Button onClick={() => setParams({ vista: view, nuevo: 'tarea' })}><Plus className="size-4" />Tarea</Button>
        </div>
      )} />
      <Tabs value={view} onChange={setView} options={[
        ['hoy', `Hoy (${views.hoy.length})`], ['proximos', 'Próximos 30 días'], ['atrasadas', `Atrasadas (${views.atrasadas.length})`],
        ['mes', 'Calendario'], ['sinfecha', 'Sin fecha'], ['completadas', 'Completadas'], ['recordatorios', 'Recordatorios'],
      ]} />
      {view === 'recordatorios' ? <Reminders /> : view === 'mes' ? <MonthCalendar tasks={open.data} onEdit={setEdit} /> : state.loading ? <Loading /> : state.error ? <ErrorBox error={state.error} /> : list.length === 0 ? (
        <Empty icon={<RotateCcw className="size-8" />} text={view === 'hoy' ? 'Nada pendiente para hoy.' : 'No hay tareas en esta vista.'} />
      ) : (
        <ul className="divide-y divide-line rounded-[--radius-card] border border-line bg-surface px-4">
          {list.map((t) => <TaskRow key={t.id} task={t} tz={tz} onEdit={setEdit} />)}
        </ul>
      )}
      <Modal open={creating === 'tarea' || !!edit} onClose={() => { setEdit(null); close(); }} title={edit ? 'Editar tarea' : 'Nueva tarea'}>
        {(creating === 'tarea' || edit) && <TaskForm task={edit} onClose={() => { setEdit(null); close(); }} />}
      </Modal>
      <Modal open={creating === 'recordatorio'} onClose={close} title="Nuevo recordatorio">
        {creating === 'recordatorio' && <ReminderForm reminder={null} onClose={close} />}
      </Modal>
    </div>
  );
}
