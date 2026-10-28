// Cliente mínimo de Firestore por REST con la forma de firebase-admin que usan los servicios
// (doc/collection/where/orderBy/limit/runTransaction, increment, serverTimestamp, Timestamp).
// Corre en Cloudflare Workers (sin SDK de Node) contra Firestore del plan gratuito o el emulador.
import { accessToken, firebaseProject } from './google-auth';

export class Timestamp {
  constructor(readonly seconds: number, readonly nanoseconds: number) {}
  static fromMillis(ms: number) {
    return new Timestamp(Math.floor(ms / 1000), Math.round((ms % 1000) * 1e6));
  }
  static fromDate(d: Date) {
    return Timestamp.fromMillis(d.getTime());
  }
  static now() {
    return Timestamp.fromMillis(Date.now());
  }
  toMillis() {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }
  toDate() {
    return new Date(this.toMillis());
  }
}

class Sentinel {
  constructor(readonly kind: 'serverTimestamp' | 'increment' | 'delete', readonly value?: number) {}
}
export const FieldValue = {
  serverTimestamp: () => new Sentinel('serverTimestamp'),
  increment: (n: number) => new Sentinel('increment', n),
  delete: () => new Sentinel('delete'),
};

type Data = Record<string, any>;
type FsValue = Record<string, any>;

// ── Codificación de valores ────────────────────────────────────────────────────────────────────
function encode(v: unknown): FsValue {
  if (v === null) return { nullValue: null };
  if (v instanceof Timestamp) return { timestampValue: v.toDate().toISOString() };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.filter((x) => x !== undefined).map(encode) } };
  if (typeof v === 'object') return { mapValue: { fields: encodeFields(v as Data) } };
  throw new Error(`Valor no soportado: ${typeof v}`);
}
function encodeFields(o: Data) {
  const out: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && !(v instanceof Sentinel)) out[k] = encode(v);
  return out;
}
function decode(v: FsValue): unknown {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return Timestamp.fromDate(new Date(v.timestampValue));
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields ?? {});
  return null;
}
const decodeFields = (f: Record<string, FsValue>): Data => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, decode(v)]));

const quote = (k: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `\`${k.replace(/[`\\]/g, '\\$&')}\``);

/** Separa los centinelas (incluidos los anidados) en transformaciones con su ruta de campo. */
function transformsOf(o: Data, prefix = ''): { transforms: FsValue[]; deletes: string[] } {
  const transforms: FsValue[] = [];
  const deletes: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    const path = prefix + quote(k);
    if (v instanceof Sentinel) {
      if (v.kind === 'serverTimestamp') transforms.push({ fieldPath: path, setToServerValue: 'REQUEST_TIME' });
      else if (v.kind === 'increment') transforms.push({ fieldPath: path, increment: encode(v.value) });
      else deletes.push(path);
    } else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Timestamp) && !(v instanceof Date)) {
      const sub = transformsOf(v, `${path}.`);
      transforms.push(...sub.transforms);
      deletes.push(...sub.deletes);
    }
  }
  return { transforms, deletes };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────────────────────
export class FirestoreError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}
const root = () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  return `${host ? `http://${host}` : 'https://firestore.googleapis.com'}/v1/projects/${firebaseProject()}/databases/(default)/documents`;
};
async function http(method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 404 && method === 'GET') return null;
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new FirestoreError(res.status, json?.error?.status ?? 'UNKNOWN', json?.error?.message ?? `Firestore ${res.status}`);
  return json;
}

// ── Referencias y consultas ─────────────────────────────────────────────────────────────────
export class DocumentSnapshot {
  constructor(readonly ref: DocumentReference, private readonly fields: Data | undefined) {}
  get id() {
    return this.ref.id;
  }
  get exists() {
    return this.fields !== undefined;
  }
  data(): Data | undefined {
    return this.fields;
  }
  get(path: string): any {
    return path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), this.fields);
  }
}

const randomId = () => {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
};

export class DocumentReference {
  constructor(readonly path: string) {}
  get id() {
    return this.path.split('/').at(-1)!;
  }
  get name() {
    return `${root().replace(/^https?:\/\/[^/]+\/v1\//, '')}/${this.path}`;
  }
  async get() {
    const json = await http('GET', `${root()}/${this.path}`);
    return new DocumentSnapshot(this, json ? decodeFields(json.fields ?? {}) : undefined);
  }
  create(data: Data) {
    return commit([write(this, 'create', data)]);
  }
  set(data: Data, opts?: { merge?: boolean }) {
    return commit([write(this, opts?.merge ? 'merge' : 'set', data)]);
  }
  update(data: Data) {
    return commit([write(this, 'update', data)]);
  }
  delete() {
    return commit([{ delete: this.name }]);
  }
}

type Op = '==' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains';
const OPS: Record<Op, string> = { '==': 'EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL', in: 'IN', 'array-contains': 'ARRAY_CONTAINS' };

export class Query {
  constructor(
    protected readonly parent: string,
    protected readonly collectionId: string,
    protected readonly allDescendants: boolean,
    private readonly filters: FsValue[] = [],
    private readonly orders: FsValue[] = [],
    private readonly max?: number,
  ) {}
  private with(p: { filters?: FsValue[]; orders?: FsValue[]; max?: number }) {
    return new Query(this.parent, this.collectionId, this.allDescendants, p.filters ?? this.filters, p.orders ?? this.orders, p.max ?? this.max);
  }
  where(field: string, op: Op, value: unknown) {
    const f = value === null && op === '=='
      ? { unaryFilter: { field: { fieldPath: field }, op: 'IS_NULL' } }
      : { fieldFilter: { field: { fieldPath: field }, op: OPS[op], value: encode(value) } };
    return this.with({ filters: [...this.filters, f] });
  }
  orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
    return this.with({ orders: [...this.orders, { field: { fieldPath: field }, direction: dir === 'desc' ? 'DESCENDING' : 'ASCENDING' }] });
  }
  limit(n: number) {
    return this.with({ max: n });
  }
  structured() {
    const where = this.filters.length === 0 ? undefined : this.filters.length === 1 ? this.filters[0] : { compositeFilter: { op: 'AND', filters: this.filters } };
    return { from: [{ collectionId: this.collectionId, allDescendants: this.allDescendants }], where, orderBy: this.orders.length ? this.orders : undefined, limit: this.max };
  }
  async get(transaction?: string) {
    const url = `${root()}${this.parent ? `/${this.parent}` : ''}:runQuery`;
    const rows = (await http('POST', url, { structuredQuery: this.structured(), ...(transaction ? { transaction } : {}) })) as { document?: { name: string; fields?: Record<string, FsValue> } }[];
    const docs = rows.filter((r) => r.document).map((r) => {
      const path = r.document!.name.split('/documents/')[1]!;
      return new DocumentSnapshot(new DocumentReference(path), decodeFields(r.document!.fields ?? {}));
    });
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
}

export class CollectionReference extends Query {
  constructor(readonly path: string) {
    const parts = path.split('/');
    super(parts.slice(0, -1).join('/'), parts.at(-1)!, false);
  }
  doc(id: string = randomId()) {
    return new DocumentReference(`${this.path}/${id}`);
  }
}

// ── Escrituras ─────────────────────────────────────────────────────────────────────────────
function write(ref: DocumentReference, mode: 'create' | 'set' | 'merge' | 'update', data: Data): FsValue {
  const { transforms, deletes } = transformsOf(data);
  const w: FsValue = { update: { name: ref.name, fields: encodeFields(data) } };
  if (mode === 'create') w.currentDocument = { exists: false };
  if (mode === 'update') w.currentDocument = { exists: true };
  if (mode === 'update' || mode === 'merge') {
    const keys = Object.entries(data).filter(([, v]) => v !== undefined && !(v instanceof Sentinel && v.kind !== 'delete')).map(([k]) => quote(k));
    w.updateMask = { fieldPaths: [...new Set([...keys, ...deletes])] };
  }
  if (transforms.length) w.updateTransforms = transforms;
  return w;
}

async function commit(writes: FsValue[], transaction?: string) {
  await http('POST', `${root()}:commit`, { writes, ...(transaction ? { transaction } : {}) }).catch((e) => {
    throw toAdminError(e);
  });
}

export class Transaction {
  readonly writes: FsValue[] = [];
  constructor(readonly id: string) {}
  async get(ref: DocumentReference) {
    // batchGet (como los SDK oficiales): GET con ?transaction= se bloquea en el emulador.
    const [row] = (await http('POST', `${root()}:batchGet`, { documents: [ref.name], transaction: this.id })) as { found?: { fields?: Record<string, FsValue> } }[];
    return new DocumentSnapshot(ref, row?.found ? decodeFields(row.found.fields ?? {}) : undefined);
  }
  create(ref: DocumentReference, data: Data) {
    this.writes.push(write(ref, 'create', data));
    return this;
  }
  set(ref: DocumentReference, data: Data, opts?: { merge?: boolean }) {
    this.writes.push(write(ref, opts?.merge ? 'merge' : 'set', data));
    return this;
  }
  update(ref: DocumentReference, data: Data) {
    this.writes.push(write(ref, 'update', data));
    return this;
  }
  delete(ref: DocumentReference) {
    this.writes.push({ delete: ref.name });
    return this;
  }
}

/** Errores de escritura que equivalen a los de firebase-admin (los servicios y pruebas los distinguen por `code`). */
const toAdminError = (e: unknown) => {
  if (e instanceof FirestoreError) {
    const code = { ALREADY_EXISTS: 'already-exists', NOT_FOUND: 'not-found', ABORTED: 'aborted', FAILED_PRECONDITION: 'failed-precondition' }[e.code];
    if (code) Object.assign(e, { code });
  }
  return e;
};

export const db = {
  doc: (path: string) => new DocumentReference(path),
  collection: (path: string) => new CollectionReference(path),
  collectionGroup: (id: string) => new Query('', id, true),
  /** Transacción optimista con reintentos ante conflicto (ABORTED), como firebase-admin. */
  async runTransaction<T>(fn: (tx: Transaction) => Promise<T>, attempts = 5): Promise<T> {
    for (let i = 1; ; i++) {
      const { transaction } = await http('POST', `${root()}:beginTransaction`, {});
      const tx = new Transaction(transaction);
      try {
        const result = await fn(tx);
        await commit(tx.writes, transaction);
        return result;
      } catch (e) {
        await http('POST', `${root()}:rollback`, { transaction }).catch(() => undefined);
        // 409 también es ALREADY_EXISTS: solo se reintenta el conflicto de transacción.
        const aborted = e instanceof FirestoreError && (e.code === 'ABORTED' || e.code === 'aborted');
        if (!aborted || i >= attempts) throw toAdminError(e);
        await new Promise((r) => setTimeout(r, 50 * 2 ** i + Math.random() * 50));
      }
    }
  },
};

export type Tx = Transaction;
export type DocRef = DocumentReference;
