import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore';

// Lo que puede hacer un cliente con la configuración pública de Firebase (sin pasar por el backend).
let env: RulesTestEnvironment;
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST!.split(':');

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-lifeos', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) } });
});
afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    const m = (sid: string, uid: string, role: string, status = 'active') => setDoc(doc(db, `spaces/${sid}/members/${uid}`), { uid, spaceId: sid, role, status });
    await setDoc(doc(db, 'users/ana'), { displayName: 'Ana' });
    await setDoc(doc(db, 'spaces/sA'), { name: 'Personal', ownerId: 'ana' });
    await setDoc(doc(db, 'spaces/biz'), { name: 'Empresa', ownerId: 'ana' });
    await m('sA', 'ana', 'owner');
    await m('biz', 'ana', 'owner');
    await m('biz', 'emp', 'member');
    await m('biz', 'vis', 'viewer');
    await m('biz', 'sup', 'supervisor');
    await m('biz', 'ex', 'member', 'removed');
    await m('biz', 'inv', 'member', 'invited');
    for (const sid of ['sA', 'biz']) {
      await setDoc(doc(db, `spaces/${sid}/tasks/t1`), { title: 'x' });
      await setDoc(doc(db, `spaces/${sid}/transactions/x1`), { amount: 1 });
      await setDoc(doc(db, `spaces/${sid}/audit/a1`), { op: 'x' });
    }
    await setDoc(doc(db, 'telegramLinkCodes/h'), { uid: 'ana' });
    await setDoc(doc(db, 'conversations/tg_1'), { uid: 'ana' });
  });
});

const as = (uid: string | null) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore();

describe('reglas de Firestore', () => {
  it('cada quien lee su perfil y su espacio; nadie el ajeno', async () => {
    await assertSucceeds(getDoc(doc(as('ana'), 'users/ana')));
    await assertFails(getDoc(doc(as('beto'), 'users/ana')));
    await assertSucceeds(getDoc(doc(as('ana'), 'spaces/sA/tasks/t1')));
    await assertFails(getDoc(doc(as('beto'), 'spaces/sA/tasks/t1')));
    await assertFails(getDocs(collection(as('beto'), 'spaces/sA/transactions')));
    await assertFails(getDoc(doc(as(null), 'spaces/sA')));
  });

  it('lectura por rol: finanzas solo propietario/admin/supervisor; auditoría solo administración', async () => {
    await assertSucceeds(getDoc(doc(as('emp'), 'spaces/biz/tasks/t1')));
    await assertFails(getDoc(doc(as('emp'), 'spaces/biz/transactions/x1')));
    await assertSucceeds(getDoc(doc(as('sup'), 'spaces/biz/transactions/x1')));
    await assertSucceeds(getDoc(doc(as('vis'), 'spaces/biz/tasks/t1')));
    await assertFails(getDoc(doc(as('vis'), 'spaces/biz/transactions/x1')));
    await assertFails(getDoc(doc(as('sup'), 'spaces/biz/audit/a1')));
    await assertSucceeds(getDoc(doc(as('ana'), 'spaces/biz/audit/a1')));
  });

  it('miembro eliminado o invitado no lee datos del espacio (el invitado ve solo su invitación)', async () => {
    await assertFails(getDoc(doc(as('ex'), 'spaces/biz/tasks/t1')));
    await assertFails(getDoc(doc(as('inv'), 'spaces/biz/tasks/t1')));
    await assertSucceeds(getDoc(doc(as('inv'), 'spaces/biz/members/inv')));
  });

  it('consulta "mis espacios" solo devuelve membresías propias', async () => {
    await assertSucceeds(getDocs(query(collectionGroup(as('emp'), 'members'), where('uid', '==', 'emp'))));
    await assertFails(getDocs(query(collectionGroup(as('emp'), 'members'), where('uid', '==', 'ana'))));
  });

  it('ningún cliente escribe directamente (todo pasa por el backend)', async () => {
    await assertFails(setDoc(doc(as('ana'), 'spaces/sA/tasks/t2'), { title: 'x' }));
    await assertFails(setDoc(doc(as('ana'), 'spaces/sA/members/beto'), { uid: 'beto', role: 'owner', status: 'active' }));
    await assertFails(setDoc(doc(as('ana'), 'users/ana'), { displayName: 'x' }));
    await assertFails(setDoc(doc(as('ana'), 'spaces/nuevo'), { name: 'x' }));
  });

  it('colecciones internas del backend son inaccesibles', async () => {
    await assertFails(getDoc(doc(as('ana'), 'telegramLinkCodes/h')));
    await assertFails(getDoc(doc(as('ana'), 'conversations/tg_1')));
  });
});

describe('reglas: módulos nuevos', () => {
  it('miembros leen proyectos, oportunidades y documentos; nadie lee el contenido de archivos directo', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      for (const p of ['projects/p1', 'opportunities/o1', 'documents/d1', 'documentFiles/d1', 'goals/g1']) await setDoc(doc(db, `spaces/biz/${p}`), { x: 1 });
    });
    for (const p of ['projects/p1', 'opportunities/o1', 'documents/d1']) await assertSucceeds(getDoc(doc(as('emp'), `spaces/biz/${p}`)));
    await assertFails(getDoc(doc(as('emp'), 'spaces/biz/goals/g1')));
    await assertSucceeds(getDoc(doc(as('ana'), 'spaces/biz/goals/g1')));
    await assertFails(getDoc(doc(as('ana'), 'spaces/biz/documentFiles/d1')));
  });
});
