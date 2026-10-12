/** The domain services' Db interface over firebase-admin (Cloud Functions side). */
import { FieldValue, type Firestore, type Query as FsQuery } from 'firebase-admin/firestore';
import { DeleteField, Increment, type Db, type Query, type Tx, type WriteOp } from '@acs/firestore';

function conv(data: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v instanceof Increment) out[k] = FieldValue.increment(v.by);
    else if (v instanceof DeleteField) out[k] = FieldValue.delete();
    else out[k] = v;
  }
  return out;
}

export class AdminDb implements Db {
  constructor(private fs: Firestore) {}

  async get<T>(path: string) {
    const s = await this.fs.doc(path).get();
    return s.exists ? (s.data() as T) : null;
  }

  async getMany<T>(paths: string[]) {
    if (!paths.length) return [];
    const snaps = await this.fs.getAll(...paths.map((p) => this.fs.doc(p)));
    return snaps.map((s) => (s.exists ? (s.data() as T) : null));
  }

  async set(path: string, data: object) { await this.fs.doc(path).set(conv(data)); }
  async create(path: string, data: object) { await this.fs.doc(path).create(conv(data)); }
  async update(path: string, data: object) { await this.fs.doc(path).update(conv(data)); }
  async delete(path: string) { await this.fs.doc(path).delete(); }

  async query<T>(collection: string, q: Query = {}) {
    let ref: FsQuery = q.group ? this.fs.collectionGroup(collection.split('/').pop()!) : this.fs.collection(collection);
    for (const [f, op, v] of q.where ?? []) ref = ref.where(f, op, v);
    for (const [f, d] of q.orderBy ?? []) ref = ref.orderBy(f, d);
    if (q.limit) ref = ref.limit(q.limit);
    return (await ref.get()).docs.map((d) => d.data() as T);
  }

  async commit(ops: WriteOp[]) {
    const b = this.fs.batch();
    for (const op of ops) {
      const ref = this.fs.doc(op.path);
      if (op.kind === 'delete') b.delete(ref);
      else if (op.kind === 'set') b.set(ref, conv(op.data));
      else if (op.kind === 'create') b.create(ref, conv(op.data));
      else b.update(ref, conv(op.data));
    }
    await b.commit();
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>) {
    return this.fs.runTransaction(async (t) => {
      const tx: Tx = {
        get: async (p) => { const s = await t.get(this.fs.doc(p)); return s.exists ? (s.data() as any) : null; },
        set: (p, d) => void t.set(this.fs.doc(p), conv(d)),
        create: (p, d) => void t.create(this.fs.doc(p), conv(d)),
        update: (p, d) => void t.update(this.fs.doc(p), conv(d)),
        delete: (p) => void t.delete(this.fs.doc(p)),
      };
      return fn(tx);
    });
  }
}
