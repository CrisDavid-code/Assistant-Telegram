import { beforeEach, describe, expect, it } from 'vitest';
import { getAuth } from 'firebase-admin/auth';
import { DateTime } from 'luxon';
import { housekeeping } from '../worker/src/admin/service';
import { sweepReminders } from '../worker/src/reminders/service';
import { Timestamp } from '../worker/src/shared/firebase';
import { runOp } from '../worker/src/api/registry';
import { clearAll, db, expectDenied, makeUser, rid, sent, tg } from './helpers';

const TZ = 'America/Guatemala';
const day = (n: number) => DateTime.now().setZone(TZ).plus({ days: n }).toISODate()!;
// PDF mínimo y un "PDF" falso (texto) en base64.
const PDF = btoa('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
const FAKE = btoa('esto no es un pdf, es texto con extensión .pdf');

beforeEach(async () => {
  await clearAll();
  sent.length = 0;
  tg.fail = false;
  delete process.env.ADMIN_UIDS;
  delete process.env.ADMIN_TELEGRAM_CHAT_ID;
});

async function business() {
  const [owner, emp] = await Promise.all([makeUser('duena'), makeUser('empleado')]);
  const { spaceId } = await owner.op('space.create', undefined, { requestId: rid(), name: 'Empresa', timezone: TZ, currency: 'GTQ' });
  await owner.op('member.invite', spaceId, { email: emp.email, role: 'member' });
  await emp.op('member.respond', spaceId, { accept: true });
  return { owner, emp, spaceId };
}

describe('tareas recurrentes', () => {
  it('al completarla crea la siguiente ocurrencia una sola vez', async () => {
    const a = await makeUser('ana');
    const s = a.personalSpaceId;
    const { taskId } = await a.op('task.create', s, { requestId: rid(), title: 'Regar plantas', dueDate: day(0), recurrence: { freq: 'weekly' } });
    const r = await a.op('task.setStatus', s, { taskId, status: 'done' });
    expect(r.nextTaskId).toBeTruthy();
    const next = (await db.doc(`spaces/${s}/tasks/${r.nextTaskId}`).get()).data()!;
    expect([next.status, next.dueDate, next.title]).toEqual(['open', day(7), 'Regar plantas']);
    await a.op('task.setStatus', s, { taskId, status: 'done' });
    expect((await db.collection(`spaces/${s}/tasks`).get()).size).toBe(2);
  });
  it('exige fecha', async () => {
    const a = await makeUser('ana');
    await expectDenied(a.op('task.create', a.personalSpaceId, { requestId: rid(), title: 'x', recurrence: { freq: 'daily' } }), 'invalid-argument');
  });
});

describe('proyectos', () => {
  it('avance real según tareas; referencias validadas', async () => {
    const a = await makeUser('ana');
    const s = a.personalSpaceId;
    const { projectId } = await a.op('project.create', s, { requestId: rid(), name: 'Sitio web' });
    const t1 = await a.op('task.create', s, { requestId: rid(), title: 'Diseño', projectId });
    await a.op('task.create', s, { requestId: rid(), title: 'Código', projectId });
    await a.op('task.setStatus', s, { taskId: t1.taskId, status: 'done' });
    const { projectProgress } = await import('../worker/src/projects/service');
    const { loadCtx } = await import('../worker/src/auth/context');
    expect(await projectProgress(await loadCtx(a.uid, s, 'pwa'), projectId)).toEqual({ total: 2, done: 1, percent: 50 });
    await expectDenied(a.op('task.create', s, { requestId: rid(), title: 'x', projectId: 'noexiste' }), 'invalid-argument');
    await a.op('project.update', s, { projectId, status: 'done' });
    expect((await db.doc(`spaces/${s}/projects/${projectId}`).get()).get('status')).toBe('done');
  });
});

describe('CRM', () => {
  it('ganar con cobro crea un cobro esperado, no un ingreso', async () => {
    const a = await makeUser('ana');
    const s = a.personalSpaceId;
    const { opportunityId } = await a.op('opportunity.create', s, { requestId: rid(), title: 'Página para Ferretería', amount: 250000, currency: 'GTQ', expectedClose: day(10) });
    await a.op('opportunity.setStage', s, { opportunityId, stage: 'proposal' });
    const r = await a.op('opportunity.setStage', s, { opportunityId, stage: 'won', createReceivable: true });
    const o = (await db.doc(`spaces/${s}/obligations/${r.obligationId}`).get()).data()!;
    expect([o.direction, o.kind, o.amount, o.status, o.dueDate]).toEqual(['receivable', 'expected', 250000, 'open', day(10)]);
    expect((await a.op('finance.summary', s, {})).totals).toEqual({});
    // Repetir no duplica el cobro.
    await a.op('opportunity.setStage', s, { opportunityId, stage: 'won', createReceivable: true });
    expect((await db.collection(`spaces/${s}/obligations`).get()).size).toBe(1);
  });
  it('un miembro sin permisos financieros no puede crear el cobro', async () => {
    const { emp, spaceId } = await business();
    const { opportunityId } = await emp.op('opportunity.create', spaceId, { requestId: rid(), title: 'Venta', amount: 1000, currency: 'GTQ' });
    await expectDenied(emp.op('opportunity.setStage', spaceId, { opportunityId, stage: 'won', createReceivable: true }));
    await emp.op('opportunity.setStage', spaceId, { opportunityId, stage: 'won' });
  });
});

describe('metas de ahorro', () => {
  it('aportes, retiros acotados y meta alcanzada', async () => {
    const a = await makeUser('ana');
    const s = a.personalSpaceId;
    const { goalId } = await a.op('goal.create', s, { requestId: rid(), name: 'Viaje', target: 100000, currency: 'GTQ' });
    await a.op('goal.contribute', s, { requestId: rid(), goalId, amount: 60000 });
    await expectDenied(a.op('goal.contribute', s, { requestId: rid(), goalId, amount: -70000 }), 'invalid-argument');
    const r = await a.op('goal.contribute', s, { requestId: rid(), goalId, amount: 40000 });
    expect([r.saved, r.reached]).toEqual([100000, true]);
    expect((await db.doc(`spaces/${s}/goals/${goalId}`).get()).get('status')).toBe('reached');
  });
  it('miembro sin permisos financieros no crea metas', async () => {
    const { emp, spaceId } = await business();
    await expectDenied(emp.op('goal.create', spaceId, { requestId: rid(), name: 'x', target: 1, currency: 'GTQ' }));
  });
});

describe('documentos', () => {
  it('guarda, valida el tipo real, descarga y programa el aviso de vencimiento', async () => {
    const a = await makeUser('ana');
    const s = a.personalSpaceId;
    const doc = await a.op('document.create', s, { requestId: rid(), title: 'Licencia', type: 'license', expiresAt: day(20), remindDaysBefore: 3, file: { name: 'licencia.pdf', base64: PDF } });
    expect(doc.reminderId).toBeTruthy();
    const meta = (await db.doc(`spaces/${s}/documents/${doc.documentId}`).get()).data()!;
    expect(meta.file.mime).toBe('application/pdf');
    expect((await a.op('document.download', s, { documentId: doc.documentId })).base64).toBe(PDF);
    await expectDenied(a.op('document.create', s, { requestId: rid(), title: 'x', type: 'other', file: { name: 'falso.pdf', base64: FAKE } }), 'invalid-argument');
    await expectDenied(a.op('document.create', s, { requestId: rid(), title: 'x', type: 'other', file: { name: 'g.pdf', base64: 'A'.repeat(1_000_000) } }), 'invalid-argument');
    await a.op('document.delete', s, { documentId: doc.documentId });
    expect((await db.doc(`spaces/${s}/documentFiles/${doc.documentId}`).get()).exists).toBe(false);
    expect((await db.doc(`spaces/${s}/reminders/${doc.reminderId}`).get()).get('status')).toBe('cancelled');
  });
  it('otra persona no puede descargar el archivo', async () => {
    const [a, b] = await Promise.all([makeUser('ana'), makeUser('beto')]);
    const { documentId } = await a.op('document.create', a.personalSpaceId, { requestId: rid(), title: 'DPI', type: 'id', file: { name: 'dpi.pdf', base64: PDF } });
    await expectDenied(b.op('document.download', a.personalSpaceId, { documentId }));
  });
});

describe('cuenta: exportación y eliminación', () => {
  it('exporta los datos de los espacios propios', async () => {
    const a = await makeUser('ana');
    await a.op('task.create', a.personalSpaceId, { requestId: rid(), title: 'Exportable' });
    const out = await a.op('account.export', undefined, {});
    expect(out.spaces[a.personalSpaceId].data.tasks.map((t: { title: string }) => t.title)).toEqual(['Exportable']);
  });
  it('bloquea si es dueña de una empresa con miembros; si no, borra todo', async () => {
    const { owner, emp, spaceId } = await business();
    await expectDenied(owner.op('account.delete', undefined, { confirm: 'ELIMINAR' }), 'failed-precondition');
    await expectDenied(owner.op('account.delete', undefined, { confirm: 'borrar' }), 'invalid-argument');
    // El empleado sí puede: sale de la empresa (sin borrarla) y se borra lo suyo.
    await emp.op('task.create', emp.personalSpaceId, { requestId: rid(), title: 'Privada' });
    expect(await emp.op('account.delete', undefined, { confirm: 'ELIMINAR' })).toEqual({ deleted: true, spacesDeleted: 1 });
    expect((await db.doc(`users/${emp.uid}`).get()).exists).toBe(false);
    expect((await db.collection(`spaces/${emp.personalSpaceId}/tasks`).get()).size).toBe(0);
    expect((await db.doc(`spaces/${spaceId}/members/${emp.uid}`).get()).get('status')).toBe('removed');
    expect((await db.doc(`spaces/${spaceId}`).get()).exists).toBe(true);
    await expect(getAuth().getUser(emp.uid)).rejects.toThrow();
  });
});

describe('plataforma: uso, administración y mantenimiento', () => {
  it('uso del plan y límites; el administrador sube el plan', async () => {
    const a = await makeUser('ana');
    const s = a.personalSpaceId;
    await a.op('assistant.message', s, { text: '¿qué pendientes tengo?' });
    expect((await a.op('usage.get', s, {})).assistant).toEqual({ used: 1, limit: 150 });
    await expectDenied(a.op('admin.stats', undefined, {}));
    process.env.ADMIN_UIDS = a.uid;
    const stats = await a.op('admin.stats', undefined, {});
    expect([stats.users, stats.spaces, stats.assistantMessages]).toEqual([1, 1, 1]);
    await a.op('admin.setPlan', undefined, { spaceId: s, plan: 'premium' });
    expect((await a.op('usage.get', s, {})).assistant.limit).toBe(2000);
  });

  it('invitar exige correo verificado (en la PWA)', async () => {
    const [a, b] = await Promise.all([makeUser('ana'), makeUser('beto')]);
    const { spaceId } = await a.op('space.create', undefined, { requestId: rid(), name: 'E', timezone: TZ, currency: 'GTQ' });
    await expectDenied(runOp({ ...a.caller, emailVerified: false }, 'member.invite', spaceId, { email: b.email, role: 'member' }), 'failed-precondition');
  });

  it('borra códigos vencidos y alerta al administrador de recordatorios fallidos', async () => {
    const a = await makeUser('ana');
    await a.op('telegram.createLinkCode', undefined, {});
    const codes = await db.collection('telegramLinkCodes').get();
    await codes.docs[0]!.ref.update({ expiresAt: Timestamp.fromMillis(Date.now() - 2 * 3_600_000) });
    const s = a.personalSpaceId;
    await db.doc(`users/${a.uid}`).update({ telegram: { chatId: 5, username: null, linkedAt: Timestamp.now() } });
    const { reminderId } = await a.op('reminder.create', s, { requestId: rid(), title: 'x', at: DateTime.now().setZone(TZ).plus({ minutes: 1 }).toFormat("yyyy-MM-dd'T'HH:mm") });
    await db.doc(`spaces/${s}/reminders/${reminderId}`).update({ attempts: 4 });
    tg.fail = true;
    await sweepReminders(new Date(Date.now() + 2 * 60_000)); // quinto intento → failed
    tg.fail = false;
    process.env.ADMIN_TELEGRAM_CHAT_ID = '777';
    expect(await housekeeping()).toEqual({ expiredCodes: 1, alerted: 1 });
    expect(sent.at(-1)).toMatchObject({ chatId: 777 });
    expect(await housekeeping()).toEqual({ expiredCodes: 0, alerted: 0 }); // no repite la alerta
  });
});
