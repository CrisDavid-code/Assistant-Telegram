import type { Source } from '@lifeos/contracts';
import { db, FieldValue, type Tx } from './firebase';

/** Registro de auditoría en la MISMA transacción que la operación: si la operación falla, no queda rastro falso. */
export function audit(
  tx: Tx,
  a: { spaceId: string; uid: string; source: Source },
  op: string,
  target: string,
  details: Record<string, unknown> = {},
) {
  tx.create(db.collection(`spaces/${a.spaceId}/audit`).doc(), {
    actorId: a.uid,
    source: a.source,
    op,
    target,
    details, // nunca secretos ni tokens
    result: 'ok',
    at: FieldValue.serverTimestamp(),
  });
}
