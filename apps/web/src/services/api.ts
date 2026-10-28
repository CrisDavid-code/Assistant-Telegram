import { FirebaseError } from 'firebase/app';
import { OPS, type OpInput, type OpName } from '@lifeos/contracts';
import { auth } from './firebase';

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8787';

/** Única puerta de escritura: el Worker (`POST /api`) valida, autoriza y ejecuta. */
export async function call<K extends OpName>(op: K, spaceId: string | undefined, data: OpInput<K>): Promise<any> {
  // Validación previa con el mismo contrato que el backend: errores claros sin viajar al servidor.
  const parsed = OPS[op].safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('. '));
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Inicia sesión para continuar.');
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ op, spaceId, data: parsed.data }), // JSON omite los campos undefined
    });
  } catch {
    throw new Error('Sin conexión con el servidor. Revisa tu internet.');
  }
  const body = (await res.json().catch(() => ({}))) as { result?: unknown; error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message ?? 'Ocurrió un error inesperado. Inténtalo de nuevo.');
  return body.result;
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
    return AUTH_MESSAGES[err.code] ?? AUTH_MESSAGES[err.code.replace(/^firestore\//, '')] ?? 'Ocurrió un error inesperado. Inténtalo de nuevo.';
  }
  return err instanceof Error ? err.message : 'Ocurrió un error inesperado.';
}
