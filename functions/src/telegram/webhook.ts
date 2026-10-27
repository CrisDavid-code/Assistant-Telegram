import { timingSafeEqual } from 'node:crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { db, FieldValue, Timestamp } from '../shared/firebase';
import '../ai/assistant'; // registra assistant.message / assistant.confirm
import { handleUpdate, type TgUpdate } from './bot';

const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Webhook HTTPS del bot. Telegram envía el secreto configurado en setWebhook en la cabecera
 * X-Telegram-Bot-Api-Secret-Token; sin él (o distinto) se rechaza.
 */
export const telegramWebhook = onRequest(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60, secrets: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'] },
  async (req, res) => {
    const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
    if (req.method !== 'POST') {
      res.status(405).end();
      return;
    }
    if (!expected || !sameSecret(String(req.get('x-telegram-bot-api-secret-token') ?? ''), expected)) {
      res.status(401).end();
      return;
    }
    const update = req.body as TgUpdate;
    if (!Number.isSafeInteger(update?.update_id)) {
      res.status(400).end();
      return;
    }
    // Idempotencia: Telegram reintenta si no recibe 200. create() falla si la actualización ya se procesó.
    try {
      await db.doc(`telegramUpdates/${update.update_id}`).create({ receivedAt: FieldValue.serverTimestamp(), expireAt: Timestamp.fromMillis(Date.now() + 7 * 86_400_000) });
    } catch {
      res.status(200).end();
      return;
    }
    try {
      await handleUpdate(update);
    } catch (err) {
      // Se responde 200 igualmente: reintentar una actualización a medio procesar podría duplicar acciones.
      logger.error('telegram.update.failed', { updateId: update.update_id, error: (err as Error).message, stack: (err as Error).stack });
    }
    res.status(200).end();
  },
);
