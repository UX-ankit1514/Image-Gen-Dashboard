/**
 * The Vercel job runner's bookkeeping against the Firestore emulator (skipped unless
 * FIRESTORE_EMULATOR_HOST is set): one runner at a time, lost work recovered, scans handed to the
 * Python scanner once, a browser step another runner holds left alone.
 */
import { describe, expect, it } from 'vitest';
import { P, RestDb } from '@acs/firestore';
import type { Job, Scan } from '@acs/types';
import { drain } from './runner';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const d = host ? describe : describe.skip;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

d('vercel job runner (emulator)', () => {
  const db = new RestDb({ projectId: `demo-runner-unit-${Date.now()}`, emulatorHost: host });
  const job = (id: string, extra: Partial<Job>): Job => ({
    id, workspaceId: 'arnifi', projectId: 'prj_t', cardId: null, batchId: null, type: 'ingest', executor: 'functions', status: 'queued',
    input: { assetId: `ast_missing_${id}`, mode: 'stored' }, output: null, provider: null, error: null, errorDetail: null, pausedReason: null,
    resumeAt: null, attempts: 0, claimedBy: null, createdAt: ago(1000), updatedAt: ago(1000), startedAt: null, endedAt: null, ...extra,
  });
  const scan = (id: string, extra: Partial<Scan>) => ({ id, projectId: 'prj_t', urls: ['https://arnifi.com/x'], status: 'queued', phase: '', createdAt: ago(1000), updatedAt: ago(1000), ...extra });

  it('recovers lost work, kicks each scan once, leaves a held browser step, and holds a lease', async () => {
    await db.set(P.job('job_lost'), job('job_lost', { status: 'running', startedAt: ago(400_000), attempts: 1 }));
    await db.set(P.job('job_dead'), job('job_dead', { status: 'running', startedAt: ago(400_000), attempts: 3 }));
    await db.set(P.job('job_live'), job('job_live', { status: 'running', startedAt: ago(5_000), attempts: 1 }));
    await db.set(P.job('job_ai'), job('job_ai', { type: 'ai.image', executor: 'companion' }));
    await db.set(P.scan('scan_new'), scan('scan_new', {}));
    await db.set(P.scan('scan_stuck'), scan('scan_stuck', { status: 'scanning', updatedAt: ago(400_000) }));
    await db.set(P.scan('scan_held'), scan('scan_held', { status: 'needs_browser', browserClaimedAt: ago(10_000) }));

    const kicked: string[] = [];
    const r = await drain(db, { budgetMs: 60_000, kickScan: async (id) => { kicked.push(id); }, kickRunner: async () => { kicked.push('runner'); } });
    const status = async (id: string) => (await db.get<Job>(P.job(id)))!;

    expect(kicked).toEqual(['scan_new']);                                  // once, though the loop ran several times
    expect((await status('job_lost')).status).toBe('failed');             // requeued, run again (its asset is missing) → failed
    expect((await status('job_lost')).attempts).toBe(2);
    expect((await status('job_dead')).status).toBe('failed');             // out of attempts
    expect((await status('job_dead')).error).toMatch(/too long/);
    expect((await status('job_live')).status).toBe('running');            // another runner is on it
    expect((await status('job_ai')).status).toBe('queued');               // companion work is not ours
    expect((await db.get<Scan>(P.scan('scan_stuck')))!.status).toBe('failed');
    expect((await db.get<Scan>(P.scan('scan_held')))!.status).toBe('needs_browser');
    expect(r).toMatchObject({ busy: false, ran: 1 });

    // a runner that holds the lease turns a second one away; releasing lets the next one in
    await db.set('runner/lease', { holder: 'run_other', until: new Date(Date.now() + 60_000).toISOString() });
    expect(await drain(db, { budgetMs: 1000, kickScan: async () => {}, kickRunner: async () => {} })).toEqual({ busy: true, ran: 0 });
    await db.set('runner/lease', { holder: 'run_other', until: new Date(0).toISOString() });
    expect((await drain(db, { budgetMs: 1000, kickScan: async () => {}, kickRunner: async () => {} })).busy).toBe(false);
  }, 60_000);
});
