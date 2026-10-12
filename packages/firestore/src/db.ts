/**
 * The storage interface every domain service is written against. Two implementations:
 *   RestDb  — Firestore REST over fetch (Cloudflare Worker, companion, tools)
 *   AdminDb — firebase-admin (Cloud Functions), in apps/functions
 * Documents carry their own `id` field.
 */
export type WhereOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains' | 'array-contains-any';

export interface Query {
  where?: [string, WhereOp, unknown][];
  orderBy?: [string, 'asc' | 'desc'][];
  limit?: number;
  /** Collection-group query across every collection with this id. */
  group?: boolean;
}

/** Sentinel values for `update`. */
export class Increment {
  constructor(public by: number) {}
}
export class DeleteField {}
export const inc = (by = 1) => new Increment(by);
export const del = () => new DeleteField();

export type WriteOp =
  | { kind: 'set'; path: string; data: object }
  | { kind: 'create'; path: string; data: object }
  | { kind: 'update'; path: string; data: object }
  | { kind: 'delete'; path: string };

export interface Tx {
  get<T>(path: string): Promise<T | null>;
  set(path: string, data: object): void;
  create(path: string, data: object): void;
  update(path: string, data: object): void;
  delete(path: string): void;
}

export interface Db {
  get<T>(path: string): Promise<T | null>;
  getMany<T>(paths: string[]): Promise<(T | null)[]>;
  set(path: string, data: object): Promise<void>;
  create(path: string, data: object): Promise<void>;
  update(path: string, data: object): Promise<void>;
  delete(path: string): Promise<void>;
  query<T>(collection: string, q?: Query): Promise<T[]>;
  /** Atomic batch of up to 500 writes. */
  commit(ops: WriteOp[]): Promise<void>;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/** Commits any number of writes in chunks of 450 (not atomic across chunks). */
export async function commitAll(db: Db, ops: WriteOp[]) {
  for (let i = 0; i < ops.length; i += 450) await db.commit(ops.slice(i, i + 450));
}
