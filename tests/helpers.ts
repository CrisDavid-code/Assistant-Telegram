// Utilidades para pruebas contra los emuladores (Firestore + Auth). Nunca apuntan a producción:
// el proyecto "demo-*" no existe en Google y firebase-admin usa los emuladores por las variables de entorno.
import { getAuth } from 'firebase-admin/auth';
import { db } from '../functions/src/shared/firebase';
import { runOp, type Caller } from '../functions/src/api/registry';
import { setTelegramClient, type InlineKeyboard } from '../functions/src/telegram/api';
import '../functions/src/ai/assistant';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Ejecuta con `npm run test:emu` (emuladores).');
export const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-lifeos';

export async function clearAll() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

let n = 0;
export const rid = () => `req_${Date.now()}_${n++}`;

export interface TestUser { uid: string; email: string; personalSpaceId: string; caller: Caller; op: (op: string, spaceId: string | undefined, data?: unknown) => Promise<any> }

export async function makeUser(name: string): Promise<TestUser> {
  const email = `${name}@test.dev`;
  const u = await getAuth().createUser({ email, password: 'secreto123', displayName: name });
  const caller: Caller = { uid: u.uid, email, name, source: 'pwa' };
  const r = (await runOp(caller, 'user.bootstrap', undefined, {})) as { personalSpaceId: string };
  return { uid: u.uid, email, personalSpaceId: r.personalSpaceId, caller, op: (o, s, d) => runOp(caller, o, s, d ?? {}) };
}

/** Cliente de Telegram falso: guarda lo enviado; `fail` simula caídas de la API. */
export const sent: { chatId: number; text: string; keyboard?: InlineKeyboard }[] = [];
export const tg = { fail: false };
setTelegramClient({
  async send(chatId, text, keyboard) {
    if (tg.fail) throw new Error('Telegram sendMessage: 502 Bad Gateway');
    sent.push({ chatId, text, keyboard });
  },
  async answerCallback() {},
  async getFile() {
    return { bytes: new Uint8Array(), path: 'x' };
  },
});

export const expectDenied = async (p: Promise<unknown>, code = 'permission-denied') => {
  const err = await p.then(() => null, (e) => e);
  if (!err || err.code !== code) throw new Error(`Se esperaba ${code}, se obtuvo ${err ? `${err.code}: ${err.message}` : 'éxito'}`);
};

export { db };
