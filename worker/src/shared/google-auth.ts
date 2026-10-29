// Credenciales de Google para el Worker: cuenta de servicio (secreto FIREBASE_SERVICE_ACCOUNT) para
// Firestore/Auth, y verificación de los tokens de sesión de Firebase que envía la PWA.
import { createRemoteJWKSet, decodeJwt, importPKCS8, jwtVerify, SignJWT } from 'jose';
import { DomainError } from './errors';

interface ServiceAccount { client_email: string; private_key: string; project_id: string }
const sa = (): ServiceAccount => {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT no configurado');
  return JSON.parse(raw);
};

export const firebaseProject = () => process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || sa().project_id;
const emulated = () => !!process.env.FIRESTORE_EMULATOR_HOST;

// Se reutiliza mientras el isolate siga vivo (una firma RS256 por hora, no por solicitud).
let cached: { token: string; exp: number } | null = null;

export async function accessToken(): Promise<string> {
  if (emulated()) return 'owner'; // el emulador acepta "owner" (salta reglas); nunca en producción
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const { client_email, private_key } = sa();
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(client_email).setAudience('https://oauth2.googleapis.com/token').setIssuedAt(now).setExpirationTime(now + 3600)
    .sign(await importPKCS8(private_key, 'RS256'));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!json.access_token) throw new Error(`Token de Google: ${json.error_description ?? res.status}`);
  cached = { token: json.access_token, exp: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return cached.token;
}

const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

export interface IdentityClaims { uid: string; email: string | null; name: string | null; emailVerified: boolean }

/** Verifica el ID token de Firebase Auth: firma de Google, emisor, audiencia y vigencia. */
export async function verifyIdToken(token: string): Promise<IdentityClaims> {
  const project = firebaseProject();
  try {
    // El emulador de Auth emite tokens sin firma; solo se aceptan si se apunta al emulador.
    const claims = process.env.FIREBASE_AUTH_EMULATOR_HOST
      ? decodeJwt(token)
      : (await jwtVerify(token, JWKS, { issuer: `https://securetoken.google.com/${project}`, audience: project, algorithms: ['RS256'] })).payload;
    if (!claims.sub) throw new Error('sin sub');
    return { uid: claims.sub, email: (claims.email as string) ?? null, name: (claims.name as string) ?? null, emailVerified: claims.email_verified === true };
  } catch {
    throw new DomainError('unauthenticated', 'Tu sesión venció. Vuelve a iniciar sesión.');
  }
}

/** Busca un usuario de Firebase Auth por correo (para invitaciones). */
export async function userByEmail(email: string): Promise<{ uid: string; displayName: string | null } | null> {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const base = host ? `http://${host}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
  const res = await fetch(`${base}/v1/projects/${firebaseProject()}/accounts:lookup`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email: [email] }),
  });
  if (!res.ok) throw new Error(`Auth lookup: ${res.status}`);
  const user = ((await res.json()) as { users?: { localId: string; displayName?: string }[] }).users?.[0];
  return user ? { uid: user.localId, displayName: user.displayName ?? null } : null;
}

/** Elimina el usuario de Firebase Auth (eliminación de cuenta). */
export async function deleteAuthUser(uid: string) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const base = host ? `http://${host}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
  const res = await fetch(`${base}/v1/projects/${firebaseProject()}/accounts:delete`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ localId: uid }),
  });
  if (!res.ok) throw new Error(`Auth delete: ${res.status}`);
}
