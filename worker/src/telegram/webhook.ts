import { timingSafeEqual } from 'node:crypto';
import { db, FieldValue, Timestamp } from '../shared/firebase';
import { logger } from '../shared/log';
import '../ai/assistant'; // registra assistant.message / assistant.confirm
import { handleUpdate, type TgUpdate } from './bot';

const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * POST /telegram — webhook del bot. Telegram envía el secreto configurado en setWebhook en la
 * cabecera X-Telegram-Bot-Api-Secret-Token; sin él (o distinto) se rechaza.
 */
export async function handleTelegram(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
  if (!expected || !sameSecret(req.headers.get('x-telegram-bot-api-secret-token') ?? '', expected)) return new Response(null, { status: 401 });
  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  if (!Number.isSafeInteger(update?.update_id)) return new Response(null, { status: 400 });
  // Idempotencia: Telegram reintenta si no recibe 200. create() falla si la actualización ya se procesó.
  try {
    await db.doc(`telegramUpdates/${update!.update_id}`).create({ receivedAt: FieldValue.serverTimestamp(), expireAt: Timestamp.fromMillis(Date.now() + 7 * 86_400_000) });
  } catch (err) {
    if ((err as { code?: string }).code === 'already-exists') return new Response(null, { status: 200 });
    throw err; // otro fallo: 500 y Telegram reintenta
  }
  try {
    await handleUpdate(update!);
  } catch (err) {
    // 200 igualmente: reintentar una actualización a medio procesar podría duplicar acciones.
    logger.error('telegram.update.failed', { updateId: update!.update_id, error: (err as Error).message, stack: (err as Error).stack });
  }
  return new Response(null, { status: 200 });
}
