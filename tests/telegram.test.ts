import { beforeEach, describe, expect, it } from 'vitest';
import { handleUpdate, type TgUpdate } from '../worker/src/telegram/bot';
import { handleTelegram } from '../worker/src/telegram/webhook';
import { Timestamp } from '../worker/src/shared/firebase';
import { setLLM } from '../worker/src/ai/provider';
import { clearAll, db, makeUser, rid, sent } from './helpers';

const CHAT = 5550001;
let updateId = 1;
const text = (t: string, chatId = CHAT, type = 'private'): TgUpdate => ({ update_id: updateId++, message: { message_id: 1, chat: { id: chatId, type }, from: { id: chatId, username: 'ana' }, text: t } });
const tap = (data: string, chatId = CHAT): TgUpdate => ({ update_id: updateId++, callback_query: { id: 'cb', from: { id: chatId }, data, message: { chat: { id: chatId, type: 'private' } } } });
const last = () => sent.at(-1)!;
const button = (label: RegExp) => last().keyboard!.flat().find((b) => label.test(b.text))!.callback_data;

beforeEach(async () => {
  await clearAll();
  sent.length = 0;
  setLLM(null); // sin IA salvo que la prueba la simule
});

async function linked() {
  const a = await makeUser('ana');
  const { code } = await a.op('telegram.createLinkCode', undefined, {});
  await handleUpdate(text(`/start ${code}`));
  return { a, code };
}

describe('vinculación', () => {
  it('/start sin cuenta explica cómo vincular y no revela datos', async () => {
    await handleUpdate(text('/start'));
    expect(last().text).toMatch(/vincula tu cuenta/i);
    await handleUpdate(text('¿Cuánto dinero tengo?'));
    expect(last().text).toMatch(/vincula tu cuenta/i);
  });

  it('código válido vincula; reutilizado o vencido se rechaza', async () => {
    const { a, code } = await linked();
    expect(last().text).toMatch(/vinculada/);
    expect((await db.doc(`users/${a.uid}`).get()).get('telegram.chatId')).toBe(CHAT);
    await handleUpdate(text(`/start ${code}`, 777));
    expect(last().text).toMatch(/no es válido o ya venció/);
    const { code: old } = await a.op('telegram.createLinkCode', undefined, {});
    const snap = await db.collection('telegramLinkCodes').where('usedAt', '==', null).get();
    await snap.docs[0]!.ref.update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    await handleUpdate(text(old, 778));
    expect(last().text).toMatch(/no es válido o ya venció/);
  });

  it('el código no se guarda en claro', async () => {
    const a = await makeUser('ana');
    const { code } = await a.op('telegram.createLinkCode', undefined, {});
    expect((await db.doc(`telegramLinkCodes/${code}`).get()).exists).toBe(false);
  });

  it('desvincular desde la app revoca el acceso del chat', async () => {
    const { a } = await linked();
    await a.op('telegram.unlink', undefined, {});
    await handleUpdate(text('/hoy'));
    expect(last().text).toMatch(/vincula tu cuenta/i);
  });

  it('en grupos no responde con información', async () => {
    await linked();
    await handleUpdate(text('/hoy', -100123, 'group'));
    expect(last().text).toMatch(/solo funciono en chats privados/);
  });
});

describe('lenguaje natural y confirmaciones', () => {
  it('gasto: propone, se confirma con botón y aparece en los datos que lee la PWA', async () => {
    const { a } = await linked();
    await handleUpdate(text('Gasté Q125 en gasolina y pagué en efectivo'));
    expect(last().text).toMatch(/Voy a registrar un gasto de Q\s?125\.00 en Transporte/);
    const ok = button(/Confirmar/);
    await handleUpdate(tap(ok));
    expect(last().text).toMatch(/Gasto registrado/);
    const txs = await db.collection(`spaces/${a.personalSpaceId}/transactions`).get();
    expect(txs.docs.map((d) => [d.get('amount'), d.get('category'), d.get('source')])).toEqual([[12500, 'transporte', 'telegram']]);
    await handleUpdate(tap(ok)); // doble toque
    expect(last().text).toMatch(/ya no es válida/);
    expect((await db.collection(`spaces/${a.personalSpaceId}/transactions`).get()).size).toBe(1);
  });

  it('con varias cuentas pregunta cuál; cancelar no guarda nada', async () => {
    const { a } = await linked();
    for (const name of ['Banco', 'Tarjeta']) await a.op('account.create', a.personalSpaceId, { requestId: rid(), name, type: 'bank', currency: 'GTQ' });
    await handleUpdate(text('Gasté Q90 en almuerzo'));
    expect(last().text).toMatch(/¿Con qué cuenta\?/);
    await handleUpdate(tap(button(/Cancelar/)));
    expect(last().text).toMatch(/Cancelado/);
    expect((await db.collection(`spaces/${a.personalSpaceId}/transactions`).get()).size).toBe(0);
  });

  it('recordatorio sin hora pregunta y completa con la respuesta', async () => {
    const { a } = await linked();
    await handleUpdate(text('Recuérdame pagar el internet'));
    expect(last().text).toBe('¿Qué día y a qué hora quieres que te lo recuerde?');
    await handleUpdate(text('mañana a las 8'));
    expect(last().text).toMatch(/Te lo recordaré .* 08:00/);
    const r = await db.collection(`spaces/${a.personalSpaceId}/reminders`).get();
    expect(r.docs.map((d) => d.get('title'))).toEqual(['Pagar el internet']);
  });

  it('una acción de la PWA se consulta desde Telegram', async () => {
    const { a } = await linked();
    await a.op('task.create', a.personalSpaceId, { requestId: rid(), title: 'Comprar alimento para los perros' });
    await handleUpdate(text('/pendientes'));
    expect(last().text).toContain('Comprar alimento para los perros');
  });

  it('usuario con varios espacios: pregunta dónde registrar y recuerda la elección', async () => {
    const { a } = await linked();
    const { spaceId } = await a.op('space.create', undefined, { requestId: rid(), name: 'Mi Empresa', timezone: 'America/Guatemala', currency: 'GTQ' });
    await handleUpdate(text('Tengo que enviar la cotización'));
    expect(last().text).toMatch(/espacio personal o en el de tu empresa/);
    await handleUpdate(tap(`sp:${spaceId}`));
    expect(last().text).toMatch(/Tarea agregada en «Mi Empresa»/);
    expect((await db.collection(`spaces/${spaceId}/tasks`).get()).size).toBe(1);
  });

  it('contacto compartido: vista previa y guardado al confirmar', async () => {
    const { a } = await linked();
    await handleUpdate({ update_id: updateId++, message: { message_id: 2, chat: { id: CHAT, type: 'private' }, contact: { phone_number: '+50255551234', first_name: 'Carlos', last_name: 'López' } } });
    expect(last().text).toMatch(/guardar el contacto Carlos López/);
    await handleUpdate(tap(button(/Confirmar/)));
    const c = await db.collection(`spaces/${a.personalSpaceId}/contacts`).get();
    expect(c.docs[0]!.get('phones')).toEqual(['+50255551234']);
  });

  it('voz e imágenes sin proveedor configurado lo dicen claramente', async () => {
    await linked();
    await handleUpdate({ update_id: updateId++, message: { message_id: 3, chat: { id: CHAT, type: 'private' }, voice: { file_id: 'v', duration: 3 } } });
    expect(last().text).toMatch(/transcripción no está configurada/);
  });
});

describe('webhook', () => {
  const call = (body: unknown, secret?: string) =>
    handleTelegram(new Request('http://worker/telegram', { method: 'POST', body: JSON.stringify(body), headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {} })).then((r) => r.status);

  it('rechaza sin secreto y procesa una sola vez cada update_id', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'secreto-de-prueba';
    const upd = text('/start');
    expect(await call(upd)).toBe(401);
    expect(await call(upd, 'otro')).toBe(401);
    expect(await call(upd, 'secreto-de-prueba')).toBe(200);
    expect(await call(upd, 'secreto-de-prueba')).toBe(200);
    expect(sent).toHaveLength(1);
  });
});

describe('IA (proveedor simulado)', () => {
  const photo = (): TgUpdate => ({ update_id: updateId++, message: { message_id: 9, chat: { id: CHAT, type: 'private' }, photo: [{ file_id: 'p', file_size: 1000 }] } });

  it('la salida inválida de la IA se descarta; la válida se propone y requiere confirmación', async () => {
    const { a } = await linked();
    setLLM({ name: 'falso', interpret: async () => ({ type: 'expense', amount: -5 }) as never });
    await handleUpdate(text('frase rarísima que las reglas no entienden'));
    expect(last().text).toMatch(/No entendí/);
    setLLM({ name: 'falso', interpret: async () => ({ type: 'expense', amount: 4500, currency: 'GTQ', category: 'alimentacion', description: 'Tacos', date: undefined }) as never });
    await handleUpdate(text('otra frase rarísima'));
    expect(last().text).toMatch(/Voy a registrar un gasto de Q\s?45\.00/);
    expect((await db.collection(`spaces/${a.personalSpaceId}/transactions`).get()).size).toBe(0);
    setLLM(null);
  });

  it('un recibo en imagen genera una propuesta, nunca un registro directo', async () => {
    const { a } = await linked();
    setLLM({ name: 'falso', interpret: async () => ({ type: 'unknown' }), extractFromImage: async () => ({ type: 'expense', amount: 23050, currency: 'GTQ', category: 'alimentacion', description: 'Supermercado' }) as never });
    await handleUpdate(photo());
    expect(last().text).toMatch(/Q\s?230\.50.*¿Confirmas\?/s);
    expect((await db.collection(`spaces/${a.personalSpaceId}/transactions`).get()).size).toBe(0);
    await handleUpdate(tap(button(/Confirmar/)));
    expect((await db.collection(`spaces/${a.personalSpaceId}/transactions`).get()).size).toBe(1);
    setLLM(null);
  });
});
