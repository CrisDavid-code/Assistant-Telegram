import { DomainError } from '../shared/errors';
import { logger } from '../shared/log';
import { verifyIdToken } from '../shared/google-auth';
import '../ai/assistant'; // registra assistant.message / assistant.confirm
import { runOp } from './registry';

const STATUS: Record<DomainError['code'], number> = {
  'invalid-argument': 400, unauthenticated: 401, 'permission-denied': 403, 'not-found': 404,
  'already-exists': 409, 'failed-precondition': 412, 'resource-exhausted': 429,
};

/** Orígenes permitidos (CORS): la PWA en producción y, en desarrollo, localhost. */
function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || (!!process.env.FIRESTORE_EMULATOR_HOST && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return ok ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-max-age': '86400', vary: 'origin' } : { vary: 'origin' };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** POST /api  { op, spaceId?, data }  con  Authorization: Bearer <ID token de Firebase>. */
export async function handleApi(req: Request): Promise<Response> {
  const h = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (req.method !== 'POST') return json({ error: { code: 'method', message: 'Método no permitido' } }, 405, h);
  let op = '';
  try {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw new DomainError('unauthenticated', 'Inicia sesión para continuar.');
    const user = await verifyIdToken(token);
    const body = (await req.json().catch(() => ({}))) as { op?: string; spaceId?: string; data?: unknown };
    op = String(body.op);
    const result = await runOp({ uid: user.uid, email: user.email, name: user.name, emailVerified: user.emailVerified, source: 'pwa' }, op, body.spaceId, body.data);
    return json({ result: result ?? null }, 200, h);
  } catch (err) {
    if (err instanceof DomainError) return json({ error: { code: err.code, message: err.message } }, STATUS[err.code], h);
    logger.error('api.error', { op, error: (err as Error)?.message, stack: (err as Error)?.stack });
    return json({ error: { code: 'internal', message: 'Ocurrió un error inesperado. Inténtalo de nuevo.' } }, 500, h);
  }
}
