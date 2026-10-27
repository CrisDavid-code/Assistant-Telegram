import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';

if (!getApps().length) initializeApp();

export const db = getFirestore();
// Los campos opcionales ausentes (undefined) se omiten en vez de fallar.
db.settings({ ignoreUndefinedProperties: true });
export { FieldValue, Timestamp };
export type Tx = FirebaseFirestore.Transaction;
