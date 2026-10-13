/**
 * Background jobs (PRD §64). A job is a Firestore document; Cloud Functions pick up
 * `executor: functions` jobs when they enter `queued`, the Local Companion claims
 * `executor: companion` jobs. Long work never blocks an HTTP request, and every job carries the full
 * input it needs, so a failed or paused job can be retried later with nothing lost (PRD §97).
 */
import { detailOf, friendly, newId, nowIso } from '@acs/shared';
import type { Batch, Job, JobStatus, JobType } from '@acs/types';
import { commitAll, inc, type Db, type WriteOp } from '../db';
import { P } from '../paths';
import type { Ctx } from './context';

export interface NewJob {
  type: JobType;
  executor?: Job['executor'];
  projectId?: string | null;
  cardId?: string | null;
  batchId?: string | null;
  provider?: string | null;
  input: Record<string, unknown>;
}

export function makeJob(ctx: Ctx, j: NewJob): Job {
  const t = nowIso();
  return {
    id: newId('job'), workspaceId: ctx.ws, projectId: j.projectId ?? null, cardId: j.cardId ?? null, batchId: j.batchId ?? null,
    type: j.type, executor: j.executor ?? (j.type.startsWith('ai.') ? 'companion' : 'functions'), status: 'queued',
    input: j.input, output: null, provider: j.provider ?? null, error: null, errorDetail: null, pausedReason: null,
    resumeAt: null, attempts: 0, claimedBy: null, createdAt: t, updatedAt: t, startedAt: null, endedAt: null,
  };
}

export function jobOp(job: Job): WriteOp {
  return { kind: 'create', path: P.job(job.id), data: job };
}

export async function enqueue(ctx: Ctx, j: NewJob) {
  const job = makeJob(ctx, j);
  await ctx.db.create(P.job(job.id), job);
  return job;
}

/** A batch groups per-card jobs so 27 successes survive 3 failures (PRD §64). */
export async function enqueueBatch(ctx: Ctx, projectId: string, kind: string, label: string, jobs: NewJob[]) {
  const t = nowIso();
  const batch: Batch = { id: newId('bat'), projectId, kind, label, total: jobs.length, completed: 0, failed: 0,
    status: jobs.length ? 'running' : 'completed', jobIds: [], createdAt: t, updatedAt: t };
  const docs = jobs.map((j) => makeJob(ctx, { ...j, batchId: batch.id, projectId }));
  batch.jobIds = docs.map((d) => d.id).slice(0, 1000);
  const ops: WriteOp[] = [{ kind: 'create', path: P.batch(batch.id), data: batch }, ...docs.map(jobOp)];
  for (let i = 0; i < ops.length; i += 450) await ctx.db.commit(ops.slice(i, i + 450));
  return { batch, jobs: docs };
}

/** Adds jobs to an existing batch (a card generated again from the review screen), so the batch
 *  stays the one record of that run and its progress counts the new job too. */
export async function appendToBatch(ctx: Ctx, batchId: string, jobs: NewJob[]) {
  const docs = await ctx.db.transaction(async (tx) => {
    const b = await tx.get<Batch>(P.batch(batchId));
    if (!b) throw new Error(`batch ${batchId} missing`);
    const made = jobs.map((j) => makeJob(ctx, { ...j, batchId, projectId: b.projectId }));
    tx.update(P.batch(batchId), { jobIds: [...b.jobIds, ...made.map((d) => d.id)].slice(-1000), total: b.total + made.length, status: 'running', updatedAt: nowIso() });
    return made;
  });
  await ctx.db.commit(docs.map(jobOp));
  return docs;
}

export async function getJob(db: Db, id: string) {
  return db.get<Job>(P.job(id));
}

export async function setJobStatus(db: Db, id: string, status: JobStatus, extra: Partial<Job> = {}) {
  const t = nowIso();
  const patch: Partial<Job> = { status, updatedAt: t, ...extra };
  if (status === 'running' || status === 'preparing') patch.startedAt = extra.startedAt ?? t;
  if (status === 'completed' || status === 'failed' || status === 'cancelled') patch.endedAt = t;
  await db.update(P.job(id), patch);
}

function batchStatus(b: Batch): Batch['status'] {
  const cancelled = b.cancelled ?? 0;
  if (b.completed + b.failed + cancelled < b.total) return 'running';
  if (cancelled) return 'cancelled';
  return b.failed === 0 ? 'completed' : b.completed === 0 ? 'failed' : 'partial';
}

async function settleBatch(db: Db, batchId: string, field: 'completed' | 'failed') {
  await db.update(P.batch(batchId), { [field]: inc(1), updatedAt: nowIso() });
  const b = await db.get<Batch>(P.batch(batchId));
  if (b && b.completed + b.failed + (b.cancelled ?? 0) >= b.total) await db.update(P.batch(batchId), { status: batchStatus(b) });
}

export async function completeJob(db: Db, job: Job, output: Record<string, unknown> = {}) {
  await setJobStatus(db, job.id, 'completed', { output, error: null, errorDetail: null });
  if (job.batchId) await settleBatch(db, job.batchId, 'completed');
}

export async function failJob(db: Db, job: Job, err: unknown, userMessage?: string) {
  await setJobStatus(db, job.id, 'failed', { error: userMessage ?? friendly(err), errorDetail: detailOf(err).slice(0, 4000) });
  if (job.batchId) await settleBatch(db, job.batchId, 'failed');
}

/** Provider limit reached: keep everything, wait (PRD §97 "Paused — provider usage limit"). */
export async function pauseJob(db: Db, job: Job, reason: string, resumeAt: string | null) {
  await setJobStatus(db, job.id, 'paused', { pausedReason: reason, resumeAt, claimedBy: null });
}

export async function retryJob(ctx: Ctx, id: string) {
  const job = await getJob(ctx.db, id);
  if (!job) return null;
  if (job.batchId && job.status === 'failed') {
    await ctx.db.update(P.batch(job.batchId), { failed: inc(-1), status: 'running', updatedAt: nowIso() });
  }
  await setJobStatus(ctx.db, id, 'queued', { attempts: job.attempts + 1, error: null, errorDetail: null, pausedReason: null, resumeAt: null, claimedBy: null, startedAt: null, endedAt: null });
  return { ...job, status: 'queued' as const };
}

export async function retryFailed(ctx: Ctx, batchId: string) {
  const jobs = await ctx.db.query<Job>(P.jobs, { where: [['batchId', '==', batchId], ['status', '==', 'failed']] });
  for (const j of jobs) await retryJob(ctx, j.id);
  return jobs.length;
}

export async function cancelJob(ctx: Ctx, id: string) {
  const job = await getJob(ctx.db, id);
  if (!job || ['completed', 'failed', 'cancelled'].includes(job.status)) return job;
  await setJobStatus(ctx.db, id, 'cancelled');
  if (job.batchId) await settleBatch(ctx.db, job.batchId, 'failed');
  return { ...job, status: 'cancelled' as const };
}

/** Stops a whole run. Whatever is not finished is cancelled and the companion drops the one in
 *  progress; images that were already made stay on their jobs, and cancelled jobs are not failures. */
export async function cancelBatch(ctx: Ctx, batchId: string) {
  const batch = await ctx.db.get<Batch>(P.batch(batchId));
  if (!batch) return null;
  const open = ((await ctx.db.getMany<Job>(batch.jobIds.map((id) => P.job(id)))).filter(Boolean) as Job[])
    .filter((j) => ['queued', 'preparing', 'running', 'paused'].includes(j.status));
  const t = nowIso();
  await commitAll(ctx.db, open.map((j) => ({ kind: 'update' as const, path: P.job(j.id), data: { status: 'cancelled', updatedAt: t, endedAt: t, resumeAt: null, pausedReason: null } })));
  if (open.length) await ctx.db.update(P.batch(batchId), { cancelled: inc(open.length), updatedAt: t });
  const fresh = await ctx.db.get<Batch>(P.batch(batchId));
  if (fresh) await ctx.db.update(P.batch(batchId), { status: batchStatus(fresh) });
  return { cancelled: open.length };
}

export async function activeJobs(db: Db, projectId: string) {
  const all = await db.query<Job>(P.jobs, { where: [['projectId', '==', projectId]], orderBy: [['createdAt', 'desc']], limit: 300 });
  return all;
}

/** The companion asks for work; claimed in a transaction so two devices never run one job. */
export async function claimCompanionJob(db: Db, deviceId: string, types: JobType[]) {
  const candidates = await db.query<Job>(P.jobs, { where: [['executor', '==', 'companion'], ['status', '==', 'queued']], orderBy: [['createdAt', 'asc']], limit: 10 });
  for (const c of candidates) {
    if (!types.includes(c.type)) continue;
    const claimed = await db.transaction(async (tx) => {
      const fresh = await tx.get<Job>(P.job(c.id));
      if (!fresh || fresh.status !== 'queued') return null;
      tx.update(P.job(c.id), { status: 'running', claimedBy: deviceId, startedAt: nowIso(), updatedAt: nowIso(), attempts: fresh.attempts + 1 });
      return { ...fresh, status: 'running' as const, claimedBy: deviceId };
    });
    if (claimed) return claimed;
  }
  return null;
}

/** Paused jobs whose provider limit should have reset go back to the queue. */
export async function resumeDueJobs(db: Db) {
  const paused = await db.query<Job>(P.jobs, { where: [['status', '==', 'paused']], limit: 100 });
  const now = Date.now();
  let n = 0;
  for (const j of paused) {
    if (j.resumeAt && Date.parse(j.resumeAt) <= now) {
      await setJobStatus(db, j.id, 'queued', { pausedReason: null, resumeAt: null });
      n++;
    }
  }
  return n;
}
