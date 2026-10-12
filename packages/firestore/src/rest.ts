/**
 * Firestore over its REST API — works anywhere fetch does (Cloudflare Workers can't run the Admin
 * SDK). Production authenticates with a service-account JWT (google-auth.ts); the emulator accepts
 * `Bearer owner`.
 */
import { DeleteField, Increment, type Db, type Query, type Tx, type WriteOp } from './db';

type Value = Record<string, unknown>;

export interface RestDbConfig {
  projectId: string;
  /** "127.0.0.1:8080" to talk to the Firestore emulator. */
  emulatorHost?: string;
  getToken?: () => Promise<string>;
  fetch?: typeof fetch;
}

const OPS: Record<string, string> = {
  '==': 'EQUAL', '!=': 'NOT_EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL', '>': 'GREATER_THAN',
  '>=': 'GREATER_THAN_OR_EQUAL', in: 'IN', 'not-in': 'NOT_IN', 'array-contains': 'ARRAY_CONTAINS',
  'array-contains-any': 'ARRAY_CONTAINS_ANY',
};

export function encodeValue(v: unknown): Value {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) < 2 ** 53) return { integerValue: String(v) };
    return { doubleValue: Number.isFinite(v) ? v : 0 };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map((x) => encodeValue(x === undefined ? null : x)) } };
  if (typeof v === 'object') return { mapValue: { fields: encodeFields(v as Record<string, unknown>) } };
  return { stringValue: String(v) };
}

export function encodeFields(o: Record<string, unknown>) {
  const fields: Record<string, Value> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v instanceof Increment || v instanceof DeleteField) continue;
    fields[k] = encodeValue(v);
  }
  return fields;
}

export function decodeValue(v: Value): unknown {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (((v.arrayValue as Value).values as Value[]) ?? []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(((v.mapValue as Value).fields as Record<string, Value>) ?? {});
  if ('referenceValue' in v) return v.referenceValue;
  if ('bytesValue' in v) return v.bytesValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  return null;
}

export function decodeFields(fields: Record<string, Value>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = decodeValue(v);
  return out;
}

const fieldPath = (k: string) => (/^[A-Za-z_][A-Za-z_0-9]*$/.test(k) ? k : '`' + k.replace(/[`\\]/g, (c) => '\\' + c) + '`');

export class FirestoreError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export class RestDb implements Db {
  private root: string;
  private docsRoot: string;
  private namePrefix: string;
  private f: typeof fetch;

  constructor(private cfg: RestDbConfig) {
    const db = `projects/${cfg.projectId}/databases/(default)`;
    const host = cfg.emulatorHost ? `http://${cfg.emulatorHost}` : 'https://firestore.googleapis.com';
    this.root = `${host}/v1/${db}`;
    this.docsRoot = `${this.root}/documents`;
    this.namePrefix = `${db}/documents/`;
    this.f = cfg.fetch ?? ((...a) => fetch(...a));
  }

  private async headers() {
    const token = this.cfg.emulatorHost ? 'owner' : await this.cfg.getToken?.();
    return { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  }

  private async call(url: string, init: RequestInit = {}, allow404 = false) {
    const res = await this.f(url, { ...init, headers: { ...(await this.headers()), ...(init.headers as object) } });
    if (allow404 && res.status === 404) return null;
    if (!res.ok) {
      let code = String(res.status);
      let msg = res.statusText;
      try {
        const e = (await res.json()) as { error?: { status?: string; message?: string } };
        code = e.error?.status ?? code;
        msg = e.error?.message ?? msg;
      } catch { /* not json */ }
      throw new FirestoreError(res.status, code, `firestore ${code}: ${msg}`.slice(0, 400));
    }
    return res.json() as Promise<any>;
  }

  private docUrl(path: string) {
    return `${this.docsRoot}/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  private fromDoc<T>(doc: { name: string; fields?: Record<string, Value> }): T {
    return decodeFields(doc.fields ?? {}) as T;
  }

  async get<T>(path: string, transaction?: string): Promise<T | null> {
    if (transaction) {
      // transactional reads go through batchGet with the transaction in the body: the single-document
      // GET ?transaction= form hangs in the Firestore emulator, and batchGet is valid everywhere
      const res = (await this.call(`${this.docsRoot}:batchGet`, {
        method: 'POST', body: JSON.stringify({ documents: [this.namePrefix + path], transaction }),
      })) as { found?: { name: string; fields?: Record<string, Value> } }[];
      const found = res.find((r) => r.found)?.found;
      return found ? this.fromDoc<T>(found) : null;
    }
    const doc = await this.call(this.docUrl(path), {}, true);
    return doc ? this.fromDoc<T>(doc) : null;
  }

  async getMany<T>(paths: string[]): Promise<(T | null)[]> {
    if (!paths.length) return [];
    const out = new Map<string, T>();
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const res = (await this.call(`${this.docsRoot}:batchGet`, {
        method: 'POST', body: JSON.stringify({ documents: chunk.map((p) => this.namePrefix + p) }),
      })) as { found?: { name: string; fields?: Record<string, Value> } }[];
      for (const r of res) if (r.found) out.set(r.found.name.slice(this.namePrefix.length), this.fromDoc<T>(r.found));
    }
    return paths.map((p) => out.get(p) ?? null);
  }

  async set(path: string, data: object) {
    await this.commit([{ kind: 'set', path, data }]);
  }

  async create(path: string, data: object) {
    await this.commit([{ kind: 'create', path, data }]);
  }

  async update(path: string, data: object) {
    await this.commit([{ kind: 'update', path, data }]);
  }

  async delete(path: string) {
    await this.commit([{ kind: 'delete', path }]);
  }

  async query<T>(collection: string, q: Query = {}): Promise<T[]> {
    const parts = collection.split('/');
    const collectionId = parts.pop()!;
    const parent = parts.join('/');
    const url = parent ? `${this.docUrl(parent)}:runQuery` : `${this.docsRoot}:runQuery`;
    const filters = (q.where ?? []).map(([f, op, v]) =>
      v === null && (op === '==' || op === '!=')
        ? { unaryFilter: { field: { fieldPath: fieldPath(f) }, op: op === '==' ? 'IS_NULL' : 'IS_NOT_NULL' } }
        : { fieldFilter: { field: { fieldPath: fieldPath(f) }, op: OPS[op], value: encodeValue(v) } });
    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId, allDescendants: !!q.group }],
    };
    if (filters.length === 1) structuredQuery.where = filters[0];
    else if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters } };
    if (q.orderBy?.length) {
      structuredQuery.orderBy = q.orderBy.map(([f, d]) => ({ field: { fieldPath: fieldPath(f) }, direction: d === 'desc' ? 'DESCENDING' : 'ASCENDING' }));
    }
    if (q.limit) structuredQuery.limit = q.limit;
    const rows = (await this.call(url, { method: 'POST', body: JSON.stringify({ structuredQuery }) })) as { document?: { name: string; fields?: Record<string, Value> } }[];
    return rows.filter((r) => r.document).map((r) => this.fromDoc<T>(r.document!));
  }

  private toWrite(op: WriteOp) {
    const name = this.namePrefix + op.path;
    if (op.kind === 'delete') return { delete: name };
    const data = op.data as Record<string, unknown>;
    const w: Record<string, unknown> = { update: { name, fields: encodeFields(data) } };
    if (op.kind === 'create') w.currentDocument = { exists: false };
    if (op.kind === 'update') {
      const plain = Object.entries(data).filter(([, v]) => v !== undefined && !(v instanceof Increment)).map(([k]) => fieldPath(k));
      w.updateMask = { fieldPaths: plain };
      w.currentDocument = { exists: true };
      const incs = Object.entries(data).filter(([, v]) => v instanceof Increment);
      if (incs.length) {
        w.updateTransforms = incs.map(([k, v]) => ({ fieldPath: fieldPath(k), increment: encodeValue((v as Increment).by) }));
      }
    }
    return w;
  }

  async commit(ops: WriteOp[], transaction?: string) {
    if (!ops.length && !transaction) return;
    await this.call(`${this.docsRoot}:commit`, {
      method: 'POST', body: JSON.stringify({ writes: ops.map((o) => this.toWrite(o)), ...(transaction ? { transaction } : {}) }),
    });
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const { transaction } = (await this.call(`${this.docsRoot}:beginTransaction`, {
        method: 'POST', body: JSON.stringify({ options: { readWrite: {} } }),
      })) as { transaction: string };
      const writes: WriteOp[] = [];
      const tx: Tx = {
        get: (p) => this.get(p, transaction),
        set: (path, data) => void writes.push({ kind: 'set', path, data }),
        create: (path, data) => void writes.push({ kind: 'create', path, data }),
        update: (path, data) => void writes.push({ kind: 'update', path, data }),
        delete: (path) => void writes.push({ kind: 'delete', path }),
      };
      try {
        const result = await fn(tx);
        await this.commit(writes, transaction);
        return result;
      } catch (e) {
        const retry = e instanceof FirestoreError && e.code === 'ABORTED' && attempt < 5;
        if (!retry) {
          await this.call(`${this.docsRoot}:rollback`, { method: 'POST', body: JSON.stringify({ transaction }) }).catch(() => {});
          throw e;
        }
        await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      }
    }
  }
}
