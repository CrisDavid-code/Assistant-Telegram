// Punto de entrada de Cloud Functions (2.ª generación).
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { sweepReminders } from './reminders/service';

export { api } from './api/callable';
export { telegramWebhook } from './telegram/webhook';

/** Entrega de recordatorios vencidos y recuperación de envíos interrumpidos. */
export const reminderSweep = onSchedule(
  { schedule: 'every 1 minutes', region: 'us-central1', timeoutSeconds: 120, retryCount: 0, secrets: ['TELEGRAM_BOT_TOKEN'] },
  async () => {
    const result = await sweepReminders();
    if (Object.keys(result).length) logger.info('reminders.sweep', result);
  },
);
