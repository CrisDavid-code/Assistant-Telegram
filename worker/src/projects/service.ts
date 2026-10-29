import type { OpData, ProjectDoc } from '@lifeos/contracts';
import { db, FieldValue } from '../shared/firebase';
import { fail } from '../shared/errors';
import { audit } from '../shared/audit';
import { requirePerm, type Ctx } from '../auth/context';

const ref = (ctx: Ctx, id: string) => db.doc(`spaces/${ctx.spaceId}/projects/${id}`);

export async function createProject(ctx: Ctx, input: OpData<'project.create'>) {
  requirePerm(ctx, 'core.write');
  if (input.budget && !input.currency) fail('invalid-argument', 'Indica la moneda del presupuesto.');
  const r = ref(ctx, input.requestId);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(r)).exists) return { projectId: r.id, duplicate: true };
    if (input.contactId && !(await tx.get(db.doc(`spaces/${ctx.spaceId}/contacts/${input.contactId}`))).exists) fail('invalid-argument', 'El contacto no existe en este espacio.');
    tx.create(r, {
      name: input.name, description: input.description ?? null, status: 'active', dueDate: input.dueDate ?? null,
      budget: input.budget ?? null, currency: input.currency ?? null, contactId: input.contactId ?? null,
      createdBy: ctx.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    audit(tx, ctx, 'project.create', r.path);
    return { projectId: r.id, duplicate: false };
  });
}

export async function updateProject(ctx: Ctx, input: OpData<'project.update'>) {
  requirePerm(ctx, 'core.write');
  const r = ref(ctx, input.projectId);
  const { projectId: _, ...rest } = input;
  const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  await db.runTransaction(async (tx) => {
    if (!(await tx.get(r)).exists) fail('not-found', 'Proyecto no encontrado.');
    tx.update(r, { ...patch, updatedAt: FieldValue.serverTimestamp() });
    audit(tx, ctx, 'project.update', r.path, { fields: Object.keys(patch) });
  });
  return { ok: true };
}

/** Avance real: tareas del proyecto completadas / no canceladas. */
export async function projectProgress(ctx: Ctx, projectId: string) {
  requirePerm(ctx, 'core.read');
  const tasks = db.collection(`spaces/${ctx.spaceId}/tasks`).where('projectId', '==', projectId);
  const [all, done, cancelled] = await Promise.all([tasks.aggregate(), tasks.where('status', '==', 'done').aggregate(), tasks.where('status', '==', 'cancelled').aggregate()]);
  const total = all.count - cancelled.count;
  return { total, done: done.count, percent: total ? Math.round((done.count / total) * 100) : 0 };
}

export type { ProjectDoc };
