import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { DomainError } from '../shared/errors';
import '../ai/assistant'; // registra assistant.message / assistant.confirm
import { runOp } from './registry';

/** Errores de dominio → mensaje para el usuario; el resto se registra y se responde genérico. */
export function toHttpsError(err: unknown, op: string): HttpsError {
  if (err instanceof DomainError) return new HttpsError(err.code, err.message);
  logger.error('api.error', { op, error: (err as Error)?.message, stack: (err as Error)?.stack });
  return new HttpsError('internal', 'Ocurrió un error inesperado. Inténtalo de nuevo.');
}

export const api = onCall({ region: 'us-central1', memory: '256MiB', timeoutSeconds: 60 }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Inicia sesión para continuar.');
  const { op, spaceId, data } = (req.data ?? {}) as { op?: string; spaceId?: string; data?: unknown };
  try {
    return await runOp(
      { uid: req.auth.uid, email: (req.auth.token.email as string) ?? null, name: (req.auth.token.name as string) ?? null, source: 'pwa' },
      String(op), spaceId, data,
    );
  } catch (err) {
    throw toHttpsError(err, String(op));
  }
});
