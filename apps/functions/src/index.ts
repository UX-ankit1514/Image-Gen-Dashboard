/**
 * Firebase Functions (Node): every `executor: functions` job, plus the browser step of a scan.
 * Jobs enter through Firestore — a write that puts a job into `queued` (created or retried) — so
 * nothing long ever runs inside an HTTP request (PRD §64).
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { ctxOf, completeJob, failJob, P, resumeDueJobs, setJobStatus } from '@acs/firestore';
import { expandServices } from '@acs/scraper';
import { friendly } from '@acs/shared';
import type { ExportRecord, Job, Scan } from '@acs/types';
import { AdminDb } from './adminDb';
import { chrome } from './env';
import { runExport } from './jobs/export';
import { ingest } from './jobs/ingest';
import { render } from './jobs/render';

initializeApp();
const fs = getFirestore();
fs.settings({ ignoreUndefinedProperties: true });
const db = new AdminDb(fs);

setGlobalOptions({ region: 'asia-south1', maxInstances: 10 });

const SECRETS = ['STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY'];

const HANDLERS: Partial<Record<Job['type'], (ctx: ReturnType<typeof ctxOf>, job: Job) => Promise<Record<string, unknown>>>> = {
  ingest,
  render,
  export: runExport,
};

export const onJob = onDocumentWritten(
  { document: 'jobs/{jobId}', memory: '2GiB', timeoutSeconds: 540, cpu: 1, concurrency: 1, secrets: SECRETS },
  async (event) => {
    const after = event.data?.after.data() as Job | undefined;
    const before = event.data?.before.data() as Job | undefined;
    if (!after || after.executor !== 'functions' || after.status !== 'queued' || before?.status === 'queued') return;
    const handler = HANDLERS[after.type];
    if (!handler) return;
    // claim, so a duplicate trigger delivery can't run it twice
    const claimed = await db.transaction(async (tx) => {
      const j = await tx.get<Job>(P.job(after.id));
      if (!j || j.status !== 'queued') return null;
      tx.update(P.job(after.id), { status: 'running', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      return j;
    });
    if (!claimed) return;
    const ctx = ctxOf(db, `job:${claimed.type}`);
    try {
      const output = await handler(ctx, claimed);
      await completeJob(db, claimed, output);
    } catch (err) {
      console.error(`job ${claimed.id} (${claimed.type}) failed`, err);
      await failJob(db, claimed, err);
      if (claimed.type === 'export') {
        await db.update(P.export((claimed.input as { exportId: string }).exportId), { status: 'failed', error: friendly(err) } satisfies Partial<ExportRecord>).catch(() => {});
      }
      if (claimed.type === 'ingest') {
        await db.update(P.asset((claimed.input as { assetId: string }).assetId), { status: 'failed', error: friendly(err) }).catch(() => {});
      }
    }
  },
);

/** The browser fallback of the scraping hierarchy (PRD §56): services listings, from inside the page. */
export const onScanNeedsBrowser = onDocumentWritten({ document: 'scans/{scanId}', memory: '2GiB', timeoutSeconds: 300 }, async (event) => {
  const after = event.data?.after.data() as Scan | undefined;
  const before = event.data?.before.data() as Scan | undefined;
  if (!after || after.status !== 'needs_browser' || before?.status === 'needs_browser') return;
  const c = await chrome();
  const browserRecords: Record<string, unknown[]> = {};
  try {
    for (const need of (after.browserFor ?? []) as unknown as { url: string; serviceType: string; total: number }[]) {
      const res = await expandServices(need.url, need.serviceType, { executablePath: c.executablePath, args: c.args });
      browserRecords[need.url] = res.records;
    }
    await db.update(P.scan(after.id), { browserRecords, status: 'enrich', phase: 'Reading detail pages', updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('expandServices failed', err);
    await db.update(P.scan(after.id), { status: 'failed', error: friendly(err), updatedAt: new Date().toISOString() });
  }
});

/** Jobs paused on a provider usage limit go back to the queue once the limit should have reset (PRD §97). */
export const resumePaused = onSchedule({ schedule: 'every 10 minutes', timeoutSeconds: 60 }, async () => {
  await resumeDueJobs(db);
});

export { setJobStatus };
