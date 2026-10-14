/**
 * Firebase Functions (Node): every `executor: functions` job, plus the browser step of a scan, for
 * the local emulator (and a Firebase Blaze deployment). Jobs enter through Firestore — a write that
 * puts a job into `queued` (created or retried) — so nothing long ever runs inside an HTTP request
 * (PRD §64). On Vercel the same work runs in `vercel.ts` instead.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { resumeDueJobs, setJobStatus } from '@acs/firestore';
import type { Job, Scan } from '@acs/types';
import { AdminDb } from './adminDb';
import { expandScan, isFunctionsJob, runJob } from './runner';

initializeApp();
const fs = getFirestore();
fs.settings({ ignoreUndefinedProperties: true });
const db = new AdminDb(fs);

setGlobalOptions({ region: 'asia-south1', maxInstances: 10 });

const SECRETS = ['STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY'];

export const onJob = onDocumentWritten(
  { document: 'jobs/{jobId}', memory: '2GiB', timeoutSeconds: 540, cpu: 1, concurrency: 1, secrets: SECRETS },
  async (event) => {
    const after = event.data?.after.data() as Job | undefined;
    const before = event.data?.before.data() as Job | undefined;
    if (!after || !isFunctionsJob(after) || after.status !== 'queued' || before?.status === 'queued') return;
    await runJob(db, after.id);
  },
);

/** The browser fallback of the scraping hierarchy (PRD §56): services listings, from inside the page. */
export const onScanNeedsBrowser = onDocumentWritten({ document: 'scans/{scanId}', memory: '2GiB', timeoutSeconds: 300 }, async (event) => {
  const after = event.data?.after.data() as Scan | undefined;
  const before = event.data?.before.data() as Scan | undefined;
  if (!after || after.status !== 'needs_browser' || before?.status === 'needs_browser') return;
  await expandScan(db, after);
});

/** Jobs paused on a provider usage limit go back to the queue once the limit should have reset (PRD §97). */
export const resumePaused = onSchedule({ schedule: 'every 10 minutes', timeoutSeconds: 60 }, async () => {
  await resumeDueJobs(db);
});

export { setJobStatus };
