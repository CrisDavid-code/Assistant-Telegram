// Respaldo y restauración de Firestore por REST (plan Spark: sin exportaciones administradas).
//
//   Respaldar:  FIREBASE_SERVICE_ACCOUNT="$(cat clave.json)" node scripts/backup.mjs respaldo.jsonl
//   Restaurar:  FIREBASE_SERVICE_ACCOUNT="$(cat clave.json)" node scripts/backup.mjs --restore respaldo.jsonl
//
// Guarda cada documento (con todas sus subcolecciones) en una línea JSON con los valores tal como los
// devuelve Firestore, así la restauración es exacta. El archivo contiene datos personales: guárdalo cifrado.
// Restaurar SOBRESCRIBE los documentos con el mismo nombre; hazlo primero en un proyecto de prueba.
// Contra el emulador: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=demo-lifeos node scripts/backup.mjs x.jsonl
import { createSign } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const sa = emulator ? null : JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT ?? 'null');
if (!emulator && !sa) {
  console.error('Falta FIREBASE_SERVICE_ACCOUNT (JSON de la cuenta de servicio).');
  process.exit(1);
}
const project = process.env.FIREBASE_PROJECT_ID || sa?.project_id;
const base = `${emulator ? `http://${emulator}` : 'https://firestore.googleapis.com'}/v1`;
const rootName = `projects/${project}/databases/(default)/documents`;

async function token() {
  if (emulator) return 'owner';
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`Token: ${json.error_description ?? res.status}`);
  return json.access_token;
}

const auth = { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' };
async function api(method, path, body) {
  const res = await fetch(`${base}/${path}`, { method, headers: auth, body: body && JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function collectionIds(parent) {
  const ids = [];
  let pageToken;
  do {
    const r = await api('POST', `${parent}:listCollectionIds`, { pageSize: 300, pageToken });
    ids.push(...(r.collectionIds ?? []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return ids;
}

async function dump(parent, out, counter) {
  for (const id of await collectionIds(parent)) {
    let pageToken;
    do {
      // showMissing: incluye documentos "vacíos" que solo tienen subcolecciones.
      const r = await api('GET', `${parent}/${id}?pageSize=300&showMissing=true${pageToken ? `&pageToken=${pageToken}` : ''}`);
      for (const doc of r.documents ?? []) {
        if (doc.fields) {
          out.write(`${JSON.stringify({ name: doc.name.split('/documents/')[1], fields: doc.fields })}\n`);
          counter.n++;
        }
        await dump(doc.name, out, counter);
      }
      pageToken = r.nextPageToken;
    } while (pageToken);
  }
}

const args = process.argv.slice(2);
if (args[0] === '--restore') {
  if (!args[1]) throw new Error('Indica el archivo a restaurar.');
  let batch = [];
  let n = 0;
  const flush = async () => {
    if (batch.length) await api('POST', `${rootName}:commit`, { writes: batch });
    n += batch.length;
    batch = [];
  };
  for await (const line of createInterface({ input: createReadStream(args[1]) })) {
    if (!line.trim()) continue;
    const { name, fields } = JSON.parse(line);
    batch.push({ update: { name: `${rootName}/${name}`, fields } });
    if (batch.length === 400) await flush();
  }
  await flush();
  console.log(`Restaurados ${n} documentos.`);
} else {
  const file = args[0] ?? `respaldo-${new Date().toISOString().slice(0, 10)}.jsonl`;
  const out = createWriteStream(file);
  const counter = { n: 0 };
  await dump(rootName, out, counter);
  out.end();
  console.log(`Respaldados ${counter.n} documentos en ${file}.`);
}
