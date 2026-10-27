import type { MemberDoc, OpData, TaskDoc } from '@lifeos/contracts';
import { db, FieldValue, Timestamp } from '../shared/firebase';
import { fail } from '../shared/errors';
import { audit } from '../shared/audit';
import { zoned } from '../shared/time';
import { requirePerm, type Ctx } from '../auth/context';

const col = (ctx: Ctx) => db.collection(`spaces/${ctx.spaceId}/tasks`);

/** Sin hora, la tarea vence al final del día local. */
function dueAt(ctx: Ctx, date: string | null | undefined, time: string | null | undefined) {
  return date ? Timestamp.fromDate(zoned(date, time ?? '23:59', ctx.space.timezone)) : null;
}

async function checkAssignee(ctx: Ctx, uid: string | null | undefined) {
  if (!uid) return;
  const m = (await db.doc(`spaces/${ctx.spaceId}/members/${uid}`).get()).data() as MemberDoc | undefined;
  if (m?.status !== 'active') fail('invalid-argument', 'La persona asignada no es miembro activo de este espacio.');
}

export async function createTask(ctx: Ctx, input: OpData<'task.create'>) {
  requirePerm(ctx, 'core.write');
  if (input.dueTime && !input.dueDate) fail('invalid-argument', 'Indica la fecha si indicas la hora.');
  await checkAssignee(ctx, input.assigneeId);
  if (input.contactId && !(await db.doc(`spaces/${ctx.spaceId}/contacts/${input.contactId}`).get()).exists) {
    fail('invalid-argument', 'El contacto no existe en este espacio.');
  }
  const ref = col(ctx).doc(input.requestId);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return { taskId: ref.id, duplicate: true };
    tx.create(ref, {
      title: input.title, notes: input.notes ?? null, status: 'open', priority: input.priority,
      dueDate: input.dueDate ?? null, dueTime: input.dueTime ?? null, dueAt: dueAt(ctx, input.dueDate, input.dueTime),
      tags: input.tags, assigneeId: input.assigneeId ?? null, contactId: input.contactId ?? null,
      createdBy: ctx.uid, source: ctx.source, completedAt: null,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    audit(tx, ctx, 'task.create', ref.path);
    return { taskId: ref.id, duplicate: false };
  });
}

export async function updateTask(ctx: Ctx, input: OpData<'task.update'>) {
  requirePerm(ctx, 'core.write');
  await checkAssignee(ctx, input.assigneeId);
  const ref = col(ctx).doc(input.taskId);
  await db.runTransaction(async (tx) => {
    const t = (await tx.get(ref)).data() as TaskDoc | undefined;
    if (!t) fail('not-found', 'Tarea no encontrada.');
    const { taskId: _, ...rest } = input;
    const patch: Record<string, unknown> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    const date = input.dueDate !== undefined ? input.dueDate : t!.dueDate;
    const time = input.dueTime !== undefined ? input.dueTime : t!.dueTime;
    if (time && !date) fail('invalid-argument', 'Indica la fecha si indicas la hora.');
    patch.dueAt = dueAt(ctx, date, time);
    tx.update(ref, { ...patch, updatedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, 'task.update', ref.path, { fields: Object.keys(patch) });
  });
  return { ok: true };
}

export async function setTaskStatus(ctx: Ctx, input: OpData<'task.setStatus'>) {
  requirePerm(ctx, 'core.write');
  const ref = col(ctx).doc(input.taskId);
  await db.runTransaction(async (tx) => {
    if (!(await tx.get(ref)).exists) fail('not-found', 'Tarea no encontrada.');
    tx.update(ref, {
      status: input.status,
      completedAt: input.status === 'done' ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    audit(tx, ctx, 'task.setStatus', ref.path, { status: input.status });
  });
  return { ok: true };
}

/** Agenda de un día local: tareas abiertas que vencen ese día o antes (atrasadas) y recordatorios del día. */
export async function getDailyAgenda(ctx: Ctx, date: string) {
  requirePerm(ctx, 'core.read');
  const end = Timestamp.fromDate(zoned(date, '23:59', ctx.space.timezone));
  const start = Timestamp.fromDate(zoned(date, '00:00', ctx.space.timezone));
  const [tasks, reminders] = await Promise.all([
    col(ctx).where('status', '==', 'open').where('dueAt', '<=', end).orderBy('dueAt').limit(50).get(),
    db.collection(`spaces/${ctx.spaceId}/reminders`).where('status', '==', 'scheduled')
      .where('scheduledFor', '>=', start).where('scheduledFor', '<=', end).orderBy('scheduledFor').limit(50).get(),
  ]);
  return {
    tasks: tasks.docs.map((d) => ({ id: d.id, ...(d.data() as TaskDoc) })),
    reminders: reminders.docs.map((d) => ({ id: d.id, title: d.get('title') as string, at: (d.get('scheduledFor') as Timestamp).toDate() })),
  };
}

export async function listOpenTasks(ctx: Ctx, limit = 15) {
  requirePerm(ctx, 'core.read');
  const snap = await col(ctx).where('status', '==', 'open').orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as TaskDoc) }));
}
