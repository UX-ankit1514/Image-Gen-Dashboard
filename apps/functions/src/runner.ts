/**
 * Running `executor: functions` jobs and the browser step of a scan, independent of what starts
 * them. Firebase triggers call `runJob` / `expandScan` one document at a time (local development,
 * index.ts); on Vercel there are no triggers, so `drain` claims queued work itself until the queue
 * is empty or its time is up (vercel.ts).
 */
import { ctxOf, completeJob, failJob, P, resumeDueJobs, setJobStatus, type Db } from '@acs/firestore';
import { expandServices } from '@acs/scraper';
import { friendly, newId, nowIso } from '@acs/shared';
import type { ExportRecord, Job, Scan } from '@acs/types';
import { chrome } from './env';
import { runExport } from './jobs/export';
import { ingest } from './jobs/ingest';
import { render } from './jobs/render';

const HANDLERS: Partial<Record<Job['type'], (ctx: ReturnType<typeof ctxOf>, job: Job) => Promise<Record<string, unknown>>>> = {
  ingest,
  render,
  export: runExport,
};

/** The longest a Vercel function may run; a job or scan "running" past it (plus margin) was lost. */
const FUNCTION_MS = 300_000;
const STALE_MS = FUNCTION_MS + 30_000;
const MAX_ATTEMPTS = 3;

export const isFunctionsJob = (j: Pick<Job, 'executor' | 'type'>) => j.executor === 'functions' && !!HANDLERS[j.type];

async function markFailed(db: Db, job: Job, err: unknown, message?: string) {
  await failJob(db, job, err, message);
  if (job.type === 'export') {
    await db.update(P.export((job.input as { exportId: string }).exportId), { status: 'failed', error: message ?? friendly(err) } satisfies Partial<ExportRecord>).catch(() => {});
  }
  if (job.type === 'ingest') {
    await db.update(P.asset((job.input as { assetId: string }).assetId), { status: 'failed', error: message ?? friendly(err) }).catch(() => {});
  }
}

/** Claims one queued job (a duplicate delivery or a second runner can't run it twice) and runs it. */
export async function runJob(db: Db, jobId: string) {
  const claimed = await db.transaction(async (tx) => {
    const j = await tx.get<Job>(P.job(jobId));
    if (!j || j.status !== 'queued' || !isFunctionsJob(j)) return null;
    tx.update(P.job(jobId), { status: 'running', startedAt: nowIso(), updatedAt: nowIso(), attempts: (j.attempts ?? 0) + 1 });
    return { ...j, attempts: (j.attempts ?? 0) + 1 };
  });
  if (!claimed) return false;
  const ctx = ctxOf(db, `job:${claimed.type}`);
  try {
    const output = await HANDLERS[claimed.type]!(ctx, claimed);
    await completeJob(db, claimed, output);
  } catch (err) {
    console.error(`job ${claimed.id} (${claimed.type}) failed`, err);
    await markFailed(db, claimed, err);
  }
  return true;
}

/** The browser fallback of the scraping hierarchy (PRD §56): a services listing, from inside the page. */
export async function expandScan(db: Db, scan: Scan) {
  const c = await chrome();
  const browserRecords: Record<string, unknown[]> = {};
  try {
    for (const need of (scan.browserFor ?? []) as unknown as { url: string; serviceType: string; total: number }[]) {
      const res = await expandServices(need.url, need.serviceType, { executablePath: c.executablePath, args: c.args });
      browserRecords[need.url] = res.records;
    }
    await db.update(P.scan(scan.id), { browserRecords, browserClaimedAt: null, status: 'enrich', phase: 'Reading detail pages', updatedAt: nowIso() });
  } catch (err) {
    console.error('expandServices failed', err);
    await db.update(P.scan(scan.id), { status: 'failed', error: friendly(err), browserClaimedAt: null, updatedAt: nowIso() });
  }
}

async function claimBrowserStep(db: Db, scanId: string) {
  return db.transaction(async (tx) => {
    const s = await tx.get<Scan>(P.scan(scanId));
    if (!s || s.status !== 'needs_browser') return null;
    if (s.browserClaimedAt && Date.now() - Date.parse(s.browserClaimedAt) < STALE_MS) return null;
    tx.update(P.scan(scanId), { browserClaimedAt: nowIso(), updatedAt: nowIso() });
    return s;
  });
}

/** Work lost to a function that ran out of time goes back to the queue (or fails after 3 tries). */
async function recoverStale(db: Db) {
  const now = Date.now();
  const running = await db.query<Job>(P.jobs, { where: [['executor', '==', 'functions'], ['status', '==', 'running']], limit: 50 });
  for (const j of running) {
    if (!j.startedAt || now - Date.parse(j.startedAt) < STALE_MS) continue;
    if ((j.attempts ?? 0) >= MAX_ATTEMPTS) await markFailed(db, j, new Error('job timed out'), 'This took too long and was stopped. Try again.');
    else await setJobStatus(db, j.id, 'queued', { claimedBy: null, startedAt: null });
  }
  const scanning = await db.query<Scan>(P.scans, { where: [['status', '==', 'scanning']], limit: 20 });
  for (const s of scanning) {
    if (now - Date.parse(s.updatedAt) < STALE_MS) continue;
    await db.update(P.scan(s.id), { status: 'failed', error: 'The scan took too long and was stopped. Try again with fewer links.', updatedAt: nowIso() });
  }
}

const LEASE = 'runner/lease';

/** One runner at a time: renders share a headless Chrome, and a function has 2 GB of memory. */
async function lease(db: Db, holder: string, until: number | null) {
  return db.transaction(async (tx) => {
    const l = await tx.get<{ holder: string; until: string }>(LEASE);
    const held = l && l.holder !== holder && Date.parse(l.until) > Date.now();
    if (until !== null && held) return false;
    if (until === null && l?.holder !== holder) return false;
    tx.set(LEASE, { holder, until: new Date(until ?? 0).toISOString() });
    return true;
  });
}

export interface DrainOptions {
  /** Stop taking new work after this many milliseconds, so the last job still fits in the function. */
  budgetMs: number;
  /** Starts the Python scanner for a queued scan (fire and forget). */
  kickScan: (scanId: string) => Promise<void>;
  /** Starts another runner when work is left over at the end of this one. */
  kickRunner: () => Promise<void>;
}

/** Runs queued jobs and browser steps until there are none left or the budget is spent. */
export async function drain(db: Db, opts: DrainOptions) {
  const started = Date.now();
  const holder = newId('run');
  if (!(await lease(db, holder, started + FUNCTION_MS + 15_000))) return { busy: true, ran: 0 };
  const kicks: Promise<void>[] = [];
  const kickedScans = new Set<string>();
  let ran = 0;
  let leftover = false;
  try {
    await resumeDueJobs(db);
    await recoverStale(db);
    for (;;) {
      if (Date.now() - started > opts.budgetMs) { leftover = true; break; }
      // scans are read and written by the Python scanner; this only starts it
      const scans = await db.query<Scan>(P.scans, { where: [['status', 'in', ['queued', 'enrich', 'needs_browser']]], limit: 20 });
      for (const s of scans) {
        if (s.status !== 'needs_browser' && !kickedScans.has(s.id)) { kickedScans.add(s.id); kicks.push(opts.kickScan(s.id)); }
      }
      const browse = scans.find((s) => s.status === 'needs_browser');
      if (browse) {
        const claimed = await claimBrowserStep(db, browse.id);
        if (claimed) {
          await expandScan(db, claimed);
          kicks.push(opts.kickScan(claimed.id));
          ran++;
          continue;
        }
      }
      const queued = await db.query<Job>(P.jobs, { where: [['executor', '==', 'functions'], ['status', '==', 'queued']], orderBy: [['createdAt', 'asc']], limit: 10 });
      const next = queued.find(isFunctionsJob);
      if (!next) break;
      if (await runJob(db, next.id)) ran++;
    }
  } finally {
    await lease(db, holder, null).catch(() => {});
  }
  if (leftover) kicks.push(opts.kickRunner());
  await Promise.allSettled(kicks);
  return { busy: false, ran };
}
