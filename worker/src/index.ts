// Punto de entrada del Cloudflare Worker (plan gratuito): API de la PWA, webhook de Telegram y
// barrido de recordatorios cada minuto (Cron Trigger).
import { handleApi } from './api/http';
import { handleTelegram } from './telegram/webhook';
import { sweepReminders } from './reminders/service';
import { logger } from './shared/log';
import { housekeeping } from './admin/service';
import { setWorkersAI, type WorkersAI } from './ai/whisper';

type Env = Record<string, unknown>;

/** Los servicios leen la configuración de process.env (igual en pruebas y en el Worker). */
function loadEnv(env: Env) {
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string') process.env[k] = v;
  setWorkersAI(env.AI as WorkersAI | undefined);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    loadEnv(env);
    const { pathname } = new URL(req.url);
    if (pathname === '/api') return handleApi(req);
    if (pathname === '/telegram') return handleTelegram(req);
    if (pathname === '/health') return new Response('ok');
    return new Response('No encontrado', { status: 404 });
  },
  async scheduled(event: { scheduledTime: number }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    loadEnv(env);
    ctx.waitUntil(sweepReminders().then((r) => Object.keys(r).length && logger.info('reminders.sweep', r)));
    // Mantenimiento cada 15 minutos (limpieza de códigos y alertas al administrador).
    if (new Date(event.scheduledTime).getUTCMinutes() % 15 === 0) {
      ctx.waitUntil(housekeeping().then((r) => logger.info('housekeeping', r)).catch((e) => logger.error('housekeeping', { error: (e as Error).message })));
    }
  },
};
