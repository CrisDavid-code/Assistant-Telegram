import { httpsCallable } from 'firebase/functions';
import { FirebaseError } from 'firebase/app';
import { OPS, type OpInput, type OpName } from '@lifeos/contracts';
import { functions } from './firebase';

/** Única puerta de escritura: la función `api` valida, autoriza y ejecuta. */
export async function call<K extends OpName>(op: K, spaceId: string | undefined, data: OpInput<K>): Promise<any> {
  // Validación previa con el mismo contrato que el backend: errores claros sin viajar al servidor.
  const parsed = OPS[op].safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('. '));
  // El SDK convierte `undefined` en `null`; se envía la salida validada sin campos vacíos.
  const clean = JSON.parse(JSON.stringify(parsed.data));
  const res = await httpsCallable(functions, 'api')({ op, spaceId, data: clean });
  return res.data;
}

export const newId = () => crypto.randomUUID();

const AUTH_MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/invalid-email': 'El correo no es válido.',
  'auth/email-already-in-use': 'Ya existe una cuenta con este correo.',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
  'auth/network-request-failed': 'Sin conexión. Revisa tu internet.',
  'permission-denied': 'No tienes permiso para ver esta información.',
  unavailable: 'Sin conexión con el servidor. Revisa tu internet.',
};

export function errorMessage(err: unknown): string {
  if (err instanceof FirebaseError) {
    // Los errores de la función `api` ya traen un mensaje en español para el usuario.
    if (err.code.startsWith('functions/') && err.code !== 'functions/internal' && err.message) return err.message;
    return AUTH_MESSAGES[err.code] ?? AUTH_MESSAGES[err.code.replace(/^firestore\//, '')] ?? 'Ocurrió un error inesperado. Inténtalo de nuevo.';
  }
  return err instanceof Error ? err.message : 'Ocurrió un error inesperado.';
}
