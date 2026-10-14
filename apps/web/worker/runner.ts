/**
 * Starting the job runner. Where jobs run on Firebase Functions (local emulator, Cloudflare), a
 * Firestore trigger starts them and no kicker is set. On Vercel there are no triggers: the server
 * sets a kicker, the API kicks the runner after each change, and the polls that show job and scan
 * progress kick it again when work has waited too long (a kick can be lost; the next poll repairs it).
 */
import type { Job } from '@acs/types';
import type { C } from './http';

type Kicker = (origin: string) => void;
let kicker: Kicker | null = null;

export function setRunnerKicker(k: Kicker) {
  kicker = k;
}

export function kickRunner(c: C) {
  kicker?.(new URL(c.req.url).origin);
}

/** Queued for longer than a kick takes to arrive, or running past any function's lifetime. */
const WAITING_MS = 8_000;
const LOST_MS = 330_000;
const age = (iso: string | null | undefined) => (iso ? Date.now() - Date.parse(iso) : 0);

export function needsKick(j: Pick<Job, 'executor' | 'status' | 'updatedAt' | 'startedAt' | 'resumeAt'>) {
  if (j.status === 'paused') return !!j.resumeAt && Date.parse(j.resumeAt) <= Date.now();
  if (j.executor !== 'functions') return false;
  if (j.status === 'queued') return age(j.updatedAt) > WAITING_MS;
  if (j.status === 'running') return age(j.startedAt) > LOST_MS;
  return false;
}

export function scanNeedsKick(s: { status: string; updatedAt: string }) {
  if (['queued', 'enrich', 'needs_browser'].includes(s.status)) return age(s.updatedAt) > WAITING_MS;
  return s.status === 'scanning' && age(s.updatedAt) > LOST_MS;
}
