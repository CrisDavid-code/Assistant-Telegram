import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { Bell, CalendarClock, Check, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { TASK_PRIORITIES, type ReminderDoc, type TaskDoc } from '@lifeos/contracts';
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
type View = 'hoy' | 'proximos' | 'atrasadas' | 'sinfecha' | 'completadas' | 'recordatorios';

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

function TaskForm({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const { spaceId } = useSpace();
  const { busy, error, run, clear } = useAction();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const tags = f.tags ? f.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const ok = await run(() => task
      ? call('task.update', spaceId, { taskId: task.id, title: f.title!, notes: f.notes ?? '', dueDate: f.dueDate || null, dueTime: f.dueTime || null, priority: f.priority as never, tags })
      : call('task.create', spaceId, { requestId: newId(), title: f.title!, notes: f.notes || undefined, dueDate: f.dueDate || undefined, dueTime: f.dueTime || undefined, priority: f.priority as never, tags }),
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
  const views: Record<Exclude<View, 'recordatorios'>, Task[]> = {
    hoy: open.data.filter((t) => t.dueDate && t.dueDate <= today).sort(byDue),
    proximos: open.data.filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= addDays(today, 30)).sort(byDue),
    atrasadas: open.data.filter((t) => t.dueDate && t.dueDate < today).sort(byDue),
    sinfecha: open.data.filter((t) => !t.dueDate),
    completadas: done.data,
  };
  const setView = (v: View) => setParams({ vista: v });
  const close = () => setParams(view === 'hoy' ? {} : { vista: view });
  const state = view === 'completadas' ? done : open;
  const list = view === 'recordatorios' ? [] : views[view];

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
        ['sinfecha', 'Sin fecha'], ['completadas', 'Completadas'], ['recordatorios', 'Recordatorios'],
      ]} />
      {view === 'recordatorios' ? <Reminders /> : state.loading ? <Loading /> : state.error ? <ErrorBox error={state.error} /> : list.length === 0 ? (
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
