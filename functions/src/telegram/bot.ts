import { logger } from 'firebase-functions';
import { formatMoney, type MemberDoc, type UserDoc } from '@lifeos/contracts';
import { db, FieldValue, Timestamp } from '../shared/firebase';
import { DomainError } from '../shared/errors';
import { loadCtx } from '../auth/context';
import { runOp, type Caller } from '../api/registry';
import { activeSpaces } from '../spaces/service';
import { answer, HELP, proposeFrom, proposePayment, type Reply } from '../ai/assistant';
import { getLLM } from '../ai/provider';
import { nowIn } from '../shared/time';
import { getUpcomingObligations } from '../finance/service';
import { CODE_RE, linkChat, uidForChat, unlinkTelegram } from './link';
import { esc, telegram, type InlineKeyboard } from './api';

// Adaptador de entrada: traduce actualizaciones de Telegram a operaciones de dominio (runOp).
// No contiene reglas de negocio: autorización, validación y escritura viven en los servicios.

interface TgUser { id: number; username?: string; first_name?: string }
interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  contact?: { phone_number: string; first_name: string; last_name?: string };
  voice?: { file_id: string; file_size?: number; duration: number; mime_type?: string };
  photo?: { file_id: string; file_size?: number }[];
  document?: { file_id: string; file_size?: number; mime_type?: string };
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: { chat: { id: number; type: string } } };
}

const APP_URL = () => process.env.APP_URL ?? 'la app de Aguiteks LifeOS';
const RATE_PER_MIN = 30;
const MAX_VOICE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const MENU: InlineKeyboard = [
  [{ text: '📅 Hoy', callback_data: 'q:today' }, { text: '☐ Pendientes', callback_data: 'q:pending' }],
  [{ text: '💸 Gastos del mes', callback_data: 'q:spending' }, { text: '💳 Saldos', callback_data: 'q:balance' }],
  [{ text: '🧾 Pagos de la semana', callback_data: 'q:bills' }, { text: '🗂 Espacio', callback_data: 'menu:space' }],
];

async function send(chatId: number, reply: Reply | string, extra?: InlineKeyboard) {
  const r = typeof reply === 'string' ? { text: reply } : reply;
  const kb: InlineKeyboard = r.actionId
    ? [...(r.choices ?? []).map((label, i) => [{ text: label, callback_data: `ok:${r.actionId}:${i}` }]), [{ text: '❌ Cancelar', callback_data: `no:${r.actionId}` }]]
    : (extra ?? []);
  await telegram.send(chatId, esc(r.text), kb.length ? kb : undefined);
}

/** Límite simple por chat (ventana de un minuto). */
async function allowed(chatId: number) {
  const ref = db.doc(`rateLimits/tg_${chatId}`);
  const minute = Math.floor(Date.now() / 60_000);
  return db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data();
    const count = cur?.minute === minute ? (cur.count as number) + 1 : 1;
    tx.set(ref, { minute, count, expireAt: Timestamp.fromMillis(Date.now() + 3_600_000) });
    return count <= RATE_PER_MIN;
  });
}

/** Espacio en el que opera el chat: el elegido con /espacio si sigue vigente, o el predeterminado. */
async function resolveSpace(uid: string, chatId: number) {
  const [conv, user, spaces] = await Promise.all([
    db.doc(`conversations/tg_${chatId}`).get(),
    db.doc(`users/${uid}`).get(),
    activeSpaces(uid),
  ]);
  const u = user.data() as UserDoc;
  const chosen = conv.get('spaceId') as string | undefined;
  const ids = new Set(spaces.map((s) => s.spaceId));
  const spaceId = chosen && ids.has(chosen) ? chosen : ids.has(u.defaultSpaceId) ? u.defaultSpaceId : u.personalSpaceId;
  return { spaceId, chosen: !!chosen && ids.has(chosen), spaces, user: u };
}

function spaceKeyboard(spaces: MemberDoc[], current?: string): InlineKeyboard {
  return spaces.slice(0, 8).map((s) => [{ text: `${s.spaceId === current ? '✔️ ' : ''}${s.spaceType === 'personal' ? '🏠' : '🏢'} ${s.spaceName}`, callback_data: `sp:${s.spaceId}` }]);
}

async function onboarding(chatId: number) {
  await send(chatId, [
    '👋 ¡Hola! Soy Aguiteks LifeOS, tu asistente para organizar tareas, recordatorios, finanzas y contactos.',
    '',
    'Para empezar, vincula tu cuenta:',
    `1. Abre ${APP_URL()} e inicia sesión (o crea tu cuenta).`,
    '2. Ve a Configuración → Telegram → «Generar código».',
    '3. Envíame ese código aquí (o toca el enlace que te da la app).',
    '',
    'Por seguridad, nunca te pediré tu contraseña.',
  ].join('\n'));
}

async function tryLink(chatId: number, from: TgUser | undefined, code: string) {
  try {
    const { displayName } = await linkChat(code, { chatId, username: from?.username ?? null });
    await send(chatId, `✅ Listo, ${displayName}. Tu cuenta quedó vinculada.\n\n${HELP}\n\nUsa /menu para accesos rápidos y /espacio para elegir dónde se registra todo.`, MENU);
  } catch (err) {
    await send(chatId, err instanceof DomainError ? err.message : 'No pude vincular tu cuenta. Inténtalo de nuevo.');
    if (!(err instanceof DomainError)) throw err;
  }
}

export async function handleUpdate(update: TgUpdate) {
  const cb = update.callback_query;
  const msg = update.message;
  const chat = cb?.message?.chat ?? msg?.chat;
  if (!chat) return;
  if (chat.type !== 'private') {
    // Por privacidad no se muestra información personal en grupos.
    if (msg?.text?.startsWith('/')) await send(chat.id, 'Por privacidad solo funciono en chats privados. Escríbeme directamente.');
    return;
  }
  if (!(await allowed(chat.id))) return;

  const uid = await uidForChat(chat.id);
  const text = msg?.text?.trim() ?? '';
  const [cmd, ...args] = text.split(/\s+/);
  const command = cmd?.startsWith('/') ? cmd.slice(1).split('@')[0]!.toLowerCase() : null;

  if (!uid) {
    const code = command === 'start' ? args[0] : text.toUpperCase();
    if (code && CODE_RE.test(code.toUpperCase())) return tryLink(chat.id, msg?.from, code.toUpperCase());
    if (cb) await telegram.answerCallback(cb.id);
    return onboarding(chat.id);
  }
  if (command === 'start' && args[0] && CODE_RE.test(args[0].toUpperCase())) return tryLink(chat.id, msg?.from, args[0].toUpperCase());

  const { spaceId, chosen, spaces, user } = await resolveSpace(uid, chat.id);
  const caller: Caller = { uid, email: user.email, name: user.displayName, source: 'telegram', convKey: `tg_${chat.id}` };
  const run = (op: string, data: unknown, sid = spaceId) => runOp(caller, op, sid, data) as Promise<Reply>;

  try {
    if (cb) return await onCallback(cb, chat.id, caller, spaceId, spaces, run);

    if (command) return await onCommand(command, args.join(' '), chat.id, caller, spaceId, spaces, run);

    if (msg?.contact) {
      const ctx = await loadCtx(uid, spaceId, 'telegram');
      const name = [msg.contact.first_name, msg.contact.last_name].filter(Boolean).join(' ');
      return await send(chat.id, await proposeFrom(ctx, caller, { type: 'contact', name, phone: msg.contact.phone_number.slice(0, 20) }));
    }

    if (msg?.voice) return await onVoice(msg, chat.id, run);
    if (msg?.photo || msg?.document) return await onImage(msg, chat.id, caller, spaceId);

    if (!text) return;
    // Varios espacios y nunca eligió uno en este chat: preguntar antes de registrar.
    if (spaces.length > 1 && !chosen) {
      await db.doc(`conversations/tg_${chat.id}`).set({ uid, deferredText: text.slice(0, 1000) }, { merge: true });
      return await send(chat.id, '¿Quieres registrar esto en tu espacio personal o en el de tu empresa? (Puedes cambiarlo luego con /espacio)', spaceKeyboard(spaces));
    }
    return await send(chat.id, await run('assistant.message', { text: text.slice(0, 1000) }));
  } catch (err) {
    if (err instanceof DomainError) return send(chat.id, err.message);
    throw err;
  }
}

type Run = (op: string, data: unknown, sid?: string) => Promise<Reply>;

async function onCommand(command: string, arg: string, chatId: number, caller: Caller, spaceId: string, spaces: MemberDoc[], run: Run) {
  const ctx = () => loadCtx(caller.uid, spaceId, 'telegram');
  const nl = (prefix: string, prompt: string) => (arg ? run('assistant.message', { text: `${prefix} ${arg}` }) : Promise.resolve({ text: prompt }));
  switch (command) {
    case 'start':
      return send(chatId, `Hola de nuevo, ${caller.name}. ${HELP}`, MENU);
    case 'ayuda':
    case 'help':
      return send(chatId, `${HELP}\n\nComandos: /hoy /pendientes /recordar /tarea /gasto /ingreso /pago /presupuesto /contacto /espacio /configuracion /desvincular`);
    case 'menu':
      return send(chatId, 'Accesos rápidos:', MENU);
    case 'hoy':
      return send(chatId, await answer(await ctx(), 'today'));
    case 'pendientes':
      return send(chatId, await answer(await ctx(), 'pending'));
    case 'presupuesto':
      return send(chatId, await answer(await ctx(), 'budget'));
    case 'recordar':
      return send(chatId, await nl('recuérdame', 'Escribe qué y cuándo. Ejemplo: /recordar mañana a las 8 pagar el internet'));
    case 'tarea':
      return send(chatId, await nl('tengo que', 'Escribe la tarea. Ejemplo: /tarea llamar a María el viernes'));
    case 'gasto':
      return send(chatId, await nl('gasté', 'Escribe el gasto. Ejemplo: /gasto Q125 gasolina en efectivo'));
    case 'ingreso':
      return send(chatId, await nl('recibí', 'Escribe el ingreso. Ejemplo: /ingreso Q4,500 salario'));
    case 'contacto': {
      if (!arg) return send(chatId, 'Comparte un contacto desde tu teléfono (📎 → Contacto) o escribe /contacto <nombre> para buscar.');
      const c = await ctx();
      const phone = /\+?\d[\d\s-]{6,18}\d/.exec(arg)?.[0];
      if (phone) return send(chatId, await proposeFrom(c, caller, { type: 'contact', name: arg.replace(phone, '').trim() || 'Sin nombre', phone }));
      return send(chatId, await answer(c, 'contacts', arg));
    }
    case 'pago': {
      const c = await ctx();
      const list = await getUpcomingObligations(c, nowIn(c.space.timezone).plus({ days: 30 }).toJSDate());
      if (!list.length) return send(chatId, 'No tienes pagos ni cobros pendientes en los próximos 30 días. Para registrar uno nuevo escribe, por ejemplo: «le debo Q500 a Pedro».');
      return send(chatId, 'Pagos y cobros pendientes (30 días). Toca uno para registrar su pago total; los pagos parciales se registran en la app.',
        list.slice(0, 8).map((o) => [{ text: `${o.direction === 'payable' ? '💸' : '💰'} ${o.title} · ${formatMoney(o.amount - o.paid, o.currency)}`, callback_data: `pay:${o.id}` }]));
    }
    case 'espacio':
      return send(chatId, `Espacio actual: ${spaces.find((s) => s.spaceId === spaceId)?.spaceName ?? '—'}. ¿Dónde quieres registrar?`, spaceKeyboard(spaces, spaceId));
    case 'configuracion': {
      const c = await ctx();
      return send(chatId, `Espacio: ${c.space.name}\nZona horaria: ${c.space.timezone}\nMoneda: ${c.space.currency}\n\nCambia estos datos en ${APP_URL()} → Configuración.`);
    }
    case 'desvincular':
      return send(chatId, '¿Seguro que quieres desvincular este chat de tu cuenta? Dejarás de recibir recordatorios aquí.', [[{ text: 'Sí, desvincular', callback_data: 'unlink:yes' }], [{ text: 'No', callback_data: 'unlink:no' }]]);
    default:
      return send(chatId, 'No conozco ese comando. Usa /ayuda.');
  }
}

async function onCallback(cb: NonNullable<TgUpdate['callback_query']>, chatId: number, caller: Caller, spaceId: string, spaces: MemberDoc[], run: Run) {
  await telegram.answerCallback(cb.id).catch(() => undefined);
  const [kind, a, b] = (cb.data ?? '').split(':');
  if (kind === 'ok' || kind === 'no') return send(chatId, await run('assistant.confirm', { actionId: a, accept: kind === 'ok', choice: b ? Number(b) : 0 }));
  if (kind === 'q') return send(chatId, await answer(await loadCtx(caller.uid, spaceId, 'telegram'), a as never));
  if (kind === 'menu' && a === 'space') return send(chatId, '¿En qué espacio quieres trabajar?', spaceKeyboard(spaces, spaceId));
  if (kind === 'pay' && a) return send(chatId, await proposePayment(await loadCtx(caller.uid, spaceId, 'telegram'), caller, a));
  if (kind === 'sp' && a) {
    if (!spaces.some((s) => s.spaceId === a)) return send(chatId, 'Ya no tienes acceso a ese espacio.');
    const ref = db.doc(`conversations/tg_${chatId}`);
    const deferred = (await ref.get()).get('deferredText') as string | undefined;
    await ref.set({ uid: caller.uid, spaceId: a, deferredText: FieldValue.delete(), pending: null, awaiting: null }, { merge: true });
    await send(chatId, `Trabajando en: ${spaces.find((s) => s.spaceId === a)!.spaceName}`);
    if (deferred) return send(chatId, await run('assistant.message', { text: deferred }, a));
    return;
  }
  if (kind === 'unlink') {
    if (a !== 'yes') return send(chatId, 'De acuerdo, sigue vinculado.');
    await unlinkTelegram(caller.uid, 'telegram');
    return send(chatId, 'Chat desvinculado. Para volver a usarme, genera un código nuevo en la app.');
  }
}

async function onVoice(msg: TgMessage, chatId: number, run: Run) {
  const llm = getLLM();
  if (!llm?.transcribe) return send(chatId, 'Todavía no puedo escuchar notas de voz: la transcripción no está configurada. Escríbeme el mensaje, por favor.');
  if ((msg.voice!.file_size ?? 0) > MAX_VOICE_BYTES || msg.voice!.duration > 120) return send(chatId, 'La nota de voz es muy larga (máximo 2 minutos).');
  const file = await telegram.getFile(msg.voice!.file_id);
  const text = (await llm.transcribe(file.bytes, msg.voice!.mime_type ?? 'audio/ogg')).trim();
  if (!text) return send(chatId, 'No pude entender la nota de voz. ¿Me lo escribes?');
  await send(chatId, `🎙 Entendí: «${text.slice(0, 500)}»`);
  return send(chatId, await run('assistant.message', { text: text.slice(0, 1000) }));
}

async function onImage(msg: TgMessage, chatId: number, caller: Caller, spaceId: string) {
  const llm = getLLM();
  if (!llm?.extractFromImage) return send(chatId, 'Todavía no puedo leer imágenes: el análisis de imágenes no está configurado. Escríbeme los datos, por favor.');
  const photo = msg.photo?.at(-1);
  const fileId = photo?.file_id ?? msg.document?.file_id;
  const mime = photo ? 'image/jpeg' : msg.document?.mime_type ?? '';
  if (!fileId || !/^image\/(jpeg|png|webp)$/.test(mime)) return send(chatId, 'Solo puedo leer imágenes JPG, PNG o WEBP.');
  if ((photo?.file_size ?? msg.document?.file_size ?? 0) > MAX_IMAGE_BYTES) return send(chatId, 'La imagen es muy grande (máximo 5 MB).');
  const ctx = await loadCtx(caller.uid, spaceId, 'telegram');
  const file = await telegram.getFile(fileId);
  const now = nowIn(ctx.space.timezone);
  // La imagen se procesa en memoria y no se guarda (sin retención). El resultado SIEMPRE se confirma.
  const intent = await llm.extractFromImage(file.bytes, mime, { today: now.toISODate()!, now: now.toISO()!, timezone: ctx.space.timezone, currency: ctx.space.currency })
    .catch((err) => {
      logger.warn('ai.image.failed', { error: (err as Error).message });
      return { type: 'unknown' as const };
    });
  if (intent.type === 'unknown') return send(chatId, 'No encontré información suficiente en la imagen. ¿Me escribes los datos?');
  if (intent.type === 'reminder' || intent.type === 'task') {
    return send(chatId, `En la imagen veo: «${intent.title}». Si quieres que lo registre, escríbemelo con la fecha.`);
  }
  return send(chatId, await proposeFrom(ctx, caller, intent));
}
