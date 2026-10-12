import type { Db } from '../db';
import { WS } from '../paths';

export interface Ctx {
  db: Db;
  /** Who did it. No auth in V1, so "owner" unless a companion device or a job acts. */
  actor: string;
  ws: string;
}

export function ctxOf(db: Db, actor = 'owner'): Ctx {
  return { db, actor, ws: WS };
}
