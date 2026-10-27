import { beforeEach, describe, expect, it } from 'vitest';
import { clearAll, db, expectDenied, makeUser, rid } from './helpers';

beforeEach(clearAll);

describe('aislamiento entre usuarios y espacios', () => {
  it('el registro crea perfil y espacio personal una sola vez', async () => {
    const a = await makeUser('ana');
    const again = await a.op('user.bootstrap', undefined, {});
    expect(again).toEqual({ created: false, personalSpaceId: a.personalSpaceId });
    const m = await db.doc(`spaces/${a.personalSpaceId}/members/${a.uid}`).get();
    expect(m.get('role')).toBe('owner');
  });

  it('A no puede leer ni escribir en el espacio de B cambiando el spaceId', async () => {
    const [a, b] = await Promise.all([makeUser('ana'), makeUser('beto')]);
    await expectDenied(a.op('task.create', b.personalSpaceId, { requestId: rid(), title: 'intrusa' }));
    await expectDenied(a.op('finance.summary', b.personalSpaceId, {}));
    await expectDenied(a.op('assistant.message', b.personalSpaceId, { text: '¿cuánto dinero tengo?' }));
    expect((await db.collection(`spaces/${b.personalSpaceId}/tasks`).get()).size).toBe(0);
  });

  it('un espacio inexistente responde igual que uno ajeno (no revela existencia)', async () => {
    const a = await makeUser('ana');
    await expectDenied(a.op('task.create', 'noexiste', { requestId: rid(), title: 'x' }));
  });

  it('entradas inválidas se rechazan en el borde', async () => {
    const a = await makeUser('ana');
    await expectDenied(a.op('task.create', a.personalSpaceId, { requestId: rid(), title: '' }), 'invalid-argument');
    await expectDenied(a.op('tx.record', a.personalSpaceId, { requestId: rid(), kind: 'expense', amount: 12.5, currency: 'GTQ', category: 'x', date: '2026-01-01' }), 'invalid-argument');
    await expectDenied(a.op('noexiste', a.personalSpaceId, {}), 'invalid-argument');
  });
});

describe('roles en espacios de empresa', () => {
  async function setup() {
    const [owner, emp, viewer] = await Promise.all([makeUser('duena'), makeUser('empleado'), makeUser('lector')]);
    const { spaceId } = await owner.op('space.create', undefined, { requestId: rid(), name: 'Aguiteks', timezone: 'America/Guatemala', currency: 'GTQ' });
    await owner.op('member.invite', spaceId, { email: emp.email, role: 'member' });
    await owner.op('member.invite', spaceId, { email: viewer.email, role: 'viewer' });
    return { owner, emp, viewer, spaceId };
  }

  it('invitado sin aceptar no opera; al aceptar puede registrar tareas', async () => {
    const { emp, spaceId } = await setup();
    await expectDenied(emp.op('task.create', spaceId, { requestId: rid(), title: 'x' }));
    await emp.op('member.respond', spaceId, { accept: true });
    const r = await emp.op('task.create', spaceId, { requestId: rid(), title: 'Visitar cliente' });
    expect(r.duplicate).toBe(false);
  });

  it('miembro sin permisos no registra pagos ni ve finanzas; viewer no escribe', async () => {
    const { emp, viewer, spaceId } = await setup();
    await emp.op('member.respond', spaceId, { accept: true });
    await viewer.op('member.respond', spaceId, { accept: true });
    await expectDenied(emp.op('tx.record', spaceId, { requestId: rid(), kind: 'expense', amount: 100, currency: 'GTQ', category: 'otros', date: '2026-01-01' }));
    await expectDenied(emp.op('finance.summary', spaceId, {}));
    await expectDenied(viewer.op('task.create', spaceId, { requestId: rid(), title: 'x' }));
    // La IA tampoco salta permisos: el asistente responde con el rechazo, sin registrar nada.
    const reply = await emp.op('assistant.message', spaceId, { text: 'Gasté Q100 en almuerzo' });
    expect(reply.text).toMatch(/no permite/);
    expect(reply.actionId).toBeUndefined();
  });

  it('miembro eliminado pierde el acceso y su espacio predeterminado vuelve al personal', async () => {
    const { owner, emp, spaceId } = await setup();
    await emp.op('member.respond', spaceId, { accept: true });
    await emp.op('user.setDefaultSpace', undefined, { spaceId });
    await owner.op('member.remove', spaceId, { uid: emp.uid });
    await expectDenied(emp.op('task.create', spaceId, { requestId: rid(), title: 'x' }));
    expect((await db.doc(`users/${emp.uid}`).get()).get('defaultSpaceId')).toBe(emp.personalSpaceId);
  });

  it('nadie modifica al propietario ni se autoasigna roles', async () => {
    const { owner, emp, spaceId } = await setup();
    await emp.op('member.respond', spaceId, { accept: true });
    await expectDenied(emp.op('member.update', spaceId, { uid: emp.uid, role: 'admin' }));
    await expectDenied(emp.op('member.remove', spaceId, { uid: owner.uid }));
    await expectDenied(owner.op('member.remove', spaceId, { uid: owner.uid }), 'failed-precondition');
  });

  it('el espacio personal no admite miembros', async () => {
    const [a, b] = await Promise.all([makeUser('ana'), makeUser('beto')]);
    await expectDenied(a.op('member.invite', a.personalSpaceId, { email: b.email, role: 'member' }), 'failed-precondition');
  });

  it('cada operación queda auditada con actor y operación', async () => {
    const { owner, spaceId } = await setup();
    const audit = await db.collection(`spaces/${spaceId}/audit`).get();
    const ops = audit.docs.map((d) => d.get('op'));
    expect(ops).toEqual(expect.arrayContaining(['space.create', 'member.invite']));
    expect(audit.docs.every((d) => d.get('actorId') === owner.uid)).toBe(true);
  });

  it('el límite del plan gratuito se aplica en el backend', async () => {
    const a = await makeUser('ana');
    for (let i = 0; i < 3; i++) await a.op('space.create', undefined, { requestId: rid(), name: `E${i}`, timezone: 'America/Guatemala', currency: 'GTQ' });
    await expectDenied(a.op('space.create', undefined, { requestId: rid(), name: 'E4', timezone: 'America/Guatemala', currency: 'GTQ' }), 'resource-exhausted');
  });
});

describe('idempotencia', () => {
  it('el mismo requestId no duplica registros', async () => {
    const a = await makeUser('ana');
    const id = rid();
    const one = await a.op('task.create', a.personalSpaceId, { requestId: id, title: 'Pagar luz' });
    const two = await a.op('task.create', a.personalSpaceId, { requestId: id, title: 'Pagar luz' });
    expect([one.duplicate, two.duplicate]).toEqual([false, true]);
    expect((await db.collection(`spaces/${a.personalSpaceId}/tasks`).get()).size).toBe(1);
  });
});
