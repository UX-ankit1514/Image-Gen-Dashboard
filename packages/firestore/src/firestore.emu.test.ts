/**
 * Domain flows against the Firestore emulator (skipped unless FIRESTORE_EMULATOR_HOST is set):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx vitest run packages/firestore
 */
import { describe, expect, it } from 'vitest';
import type { Asset, Card, Job, SourcePage, TextLayer } from '@acs/types';
import { RestDb } from './rest';
import { inc } from './db';
import { P } from './paths';
import { ctxOf } from './services/context';
import { createProject, getProject } from './services/projects';
import { approveCard, commitVersion, createCardsFromPages, getCardBundle, rejectCard, restoreVersion, saveDraft } from './services/cards';
import { runBatch } from './services/batch';
import { createExport } from './services/sources';
import { applyOverrides, diffOverrides, updateLayer } from '@acs/renderer';
import { seedRecipes } from './services/recipes';
import { appendToBatch, cancelBatch, claimCompanionJob, completeJob, enqueueBatch } from './services/jobs';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const d = host ? describe : describe.skip;

d('firestore domain flows (emulator)', () => {
  const db = new RestDb({ projectId: `demo-test-${Date.now()}`, emulatorHost: host });
  const ctx = ctxOf(db);

  it('REST round-trip keeps types, increments and nested maps', async () => {
    await db.set('t/a', { n: 1, f: 1.5, s: 'x', b: true, nul: null, arr: [1, 'a', { z: 2 }], m: { deep: { x: [1, 2] } } });
    await db.update('t/a', { n: inc(2), s: 'y' });
    expect(await db.get('t/a')).toEqual({ n: 3, f: 1.5, s: 'y', b: true, nul: null, arr: [1, 'a', { z: 2 }], m: { deep: { x: [1, 2] } } });
    const rows = await db.query<{ n: number }>('t', { where: [['n', '>=', 3]] });
    expect(rows).toHaveLength(1);
  });

  it('transactions read, write and serialise (companion job claims)', async () => {
    await db.set('t/tx', { n: 1 });
    const results = await Promise.all([1, 2, 3].map(() => db.transaction(async (tx) => {
      const d = await tx.get<{ n: number }>('t/tx');
      tx.update('t/tx', { n: d!.n + 1 });
      return d!.n;
    })));
    expect((await db.get<{ n: number }>('t/tx'))!.n).toBe(4);
    expect(new Set(results).size).toBe(3);
  }, 30_000);

  it('project → cards → edit → versions → approve → reject → export safety', async () => {
    await seedRecipes(ctx);
    const project = await createProject(ctx, {
      name: 'Ireland Company Setup', inputType: 'url', recipeId: 'arnifi-light', width: 1600, height: 1000,
      layers: { background: true, gradient: true, logo: true, headline: true, subheading: true }, provider: 'none',
    });
    // two scanned pages, one image each (the same photo, to exercise the repeat framing)
    const asset: Asset = { id: 'ast_test1', workspaceId: 'arnifi', projectId: project.id, type: 'image', source: 'website', role: 'banner', sourcePageId: null,
      sourceUrl: 'https://x/a.png', name: 'a.png', storageKey: 'k', thumbKey: null, previewKey: null, width: 1600, height: 1000, mimeType: 'image/png',
      bytes: 1, sha256: null, dhash: null, inkScore: null, flags: { lowRes: false }, analysis: null, status: 'ready', error: null, createdAt: new Date().toISOString() };
    await db.set(P.asset(asset.id), asset);
    const page = (id: string, h1: string): SourcePage => ({ id, projectId: project.id, scanId: 's', url: `https://arnifi.com/${id}`, slug: id, pageType: 'detail',
      title: h1, name: h1, h1, subheading: '', highlights: [{ title: 'Fast and Efficient Setup.', desc: '' }], benefits: [], country: 'Ireland', jurisdiction: null,
      authority: 'CRO', category: null, price: null, estTime: null, images: [{ url: 'https://x/a.png', role: 'banner', assetId: asset.id }], relatedLinks: [],
      rawMetadata: {}, status: 'ok', error: null, contentHash: 'h', lastScannedAt: new Date().toISOString() });
    await db.set(P.page(project.id, 'p1'), page('p1', 'Basic Registration'));
    await db.set(P.page(project.id, 'p2'), page('p2', 'Premium Registration'));

    const cards = await createCardsFromPages(ctx, project.id, ['p1', 'p2']);
    expect(cards).toHaveLength(2);
    const b1 = await getCardBundle(ctx, project.id, cards[0].id);
    const b2 = await getCardBundle(ctx, project.id, cards[1].id);
    expect((b1.design.layers.find((l) => l.id === 'subheading') as TextLayer).text).toBe('Fast and Efficient Setup');
    const bg1 = b1.design.layers.find((l) => l.id === 'background')!;
    const bg2 = b2.design.layers.find((l) => l.id === 'background')!;
    expect([bg1.type === 'background' && bg1.focalX, bg2.type === 'background' && bg2.focalX]).toEqual([0.5, 0.32]);
    const jobs = await db.query<Job>(P.jobs, { where: [['projectId', '==', project.id]] });
    expect(jobs.filter((j) => j.type === 'render')).toHaveLength(2);

    // edit → autosave draft → commit: a new version with a derived reason
    const edited = updateLayer(b1.design, 'gradient', { opacity: 0.7 });
    await saveDraft(ctx, project.id, cards[0].id, diffOverrides(b1.base, edited), b1.baseRev);
    const c1 = await commitVersion(ctx, project.id, cards[0].id);
    expect(c1.version.number).toBe(2);
    expect(c1.version.reason).toBe('Gradient changed');

    // approve V2, then edit again: the approved pointer stays on V2
    await approveCard(ctx, project.id, cards[0].id);
    const v3 = await commitVersion(ctx, project.id, cards[0].id, { overrides: diffOverrides(b1.base, updateLayer(edited, 'logo', { visible: false })), reason: 'Logo hidden' });
    const after = await db.get<Card>(P.card(project.id, cards[0].id));
    expect(after!.approvedVersionId).toBe(c1.version.id);
    expect(after!.currentVersionId).toBe(v3.version.id);
    expect(after!.status).toBe('needs_review');

    // restore keeps history: V4 = V2's design
    const r = await restoreVersion(ctx, project.id, cards[0].id, c1.version.id);
    expect(r.version.number).toBe(4);
    expect(r.version.overrides).toEqual(c1.version.overrides);

    // reject the other card: structured feedback, status from the tags
    const rej = await rejectCard(ctx, project.id, cards[1].id, ['Wrong subject', 'Looks AI-generated']);
    expect(rej.status).toBe('needs_image');

    // export is what you see: each card's current version (the restored V4 here, not the approved V2), no approval needed
    const ex = await createExport(ctx, project.id, { scope: 'selected', cardIds: [cards[0].id], format: 'png', scale: 1 });
    expect(ex.files).toEqual([{ cardId: cards[0].id, versionId: r.version.id, name: '', key: '', approved: false }]);
    const everything = await createExport(ctx, project.id, { scope: 'all', format: 'jpg', scale: 1 });
    expect(everything.files.map((f) => f.cardId)).toContain(cards[0].id);

    // batch: hide the logo on both; approval no longer protects a card
    await approveCard(ctx, project.id, cards[0].id);
    const res = await runBatch(ctx, project.id, { cardIds: cards.map((c) => c.id), scope: 'selected', op: { action: 'toggle_layer', layerId: 'logo', visible: false } });
    expect(res).toMatchObject({ changed: 2, skippedApproved: 0 });

    // project default: gradient opacity for everyone; card overrides survive
    await runBatch(ctx, project.id, { cardIds: [], scope: 'project_default', includeApproved: true, op: { action: 'patch', reason: 'Darker gradient', overrides: { layers: { gradient: { opacity: 0.9 } } } } });
    const p2 = await getProject(ctx, project.id);
    expect(p2.defaultsRev).not.toBe(project.defaultsRev);
    const nb = await getCardBundle(ctx, project.id, cards[1].id);
    expect(nb.design.layers.find((l) => l.id === 'gradient')!.opacity).toBe(0.9);
    expect(nb.design.layers.find((l) => l.id === 'logo')!.visible).toBe(false);
    expect(applyOverrides(nb.base, nb.version!.overrides)).toEqual(nb.design);
  }, 60_000);

  it('a card generated again from review joins its run, and the run settles only when it finishes', async () => {
    const job = (cardId: string) => ({ type: 'ai.image' as const, executor: 'companion' as const, cardId, input: { meta: { cardId } } });
    const { batch, jobs } = await enqueueBatch(ctx, 'prj_review', 'generate', 'Generating 2 backgrounds', [job('a'), job('b')]);
    const [extra] = await appendToBatch(ctx, batch.id, [job('a')]);
    const b1 = (await db.get<{ total: number; jobIds: string[]; status: string }>(P.batch(batch.id)))!;
    expect(b1.total).toBe(3);
    expect(b1.jobIds).toEqual([...jobs.map((j) => j.id), extra.id]);
    expect((await db.get<Job>(P.job(extra.id)))!.batchId).toBe(batch.id);
    for (const j of jobs) await completeJob(db, j, { kind: 'images', assetIds: [] });
    expect((await db.get<{ status: string }>(P.batch(batch.id)))!.status).toBe('running');
    await completeJob(db, extra, { kind: 'images', assetIds: [] });
    expect((await db.get<{ status: string }>(P.batch(batch.id)))!.status).toBe('completed');
  });

  it('cancelling a run stops what is left, keeps what was made and is not counted as a failure', async () => {
    const job = (cardId: string) => ({ type: 'ai.image' as const, executor: 'companion' as const, cardId, input: { meta: { cardId, assetIds: [] as string[] } } });
    const { batch, jobs } = await enqueueBatch(ctx, 'prj_cancel', 'generate', 'Generating 4 backgrounds', [job('a'), job('b'), job('c'), job('d')]);
    await completeJob(db, jobs[0], { kind: 'images', assetIds: ['ast_kept'] });          // a: finished
    const running = (await claimCompanionJob(db, 'dev_1', ['ai.image']))!;                // one more is in progress
    expect(jobs.slice(1).map((j) => j.id)).toContain(running.id);
    const r = await cancelBatch(ctx, batch.id);
    expect(r).toEqual({ cancelled: 3 });
    const status = async (id: string) => (await db.get<Job>(P.job(id)))!.status;
    expect(await status(jobs[0].id)).toBe('completed');                                   // made images stay
    expect(await Promise.all(jobs.slice(1).map((j) => status(j.id)))).toEqual(['cancelled', 'cancelled', 'cancelled']);   // the running one too
    expect((await db.get<Job>(P.job(running.id)))!.claimedBy).toBe('dev_1');             // the companion can still ask and see it
    expect(await claimCompanionJob(db, 'dev_1', ['ai.image'])).toBeNull();                // nothing left to take
    expect(await db.get(P.batch(batch.id))).toMatchObject({ status: 'cancelled', completed: 1, failed: 0, cancelled: 3, total: 4 });
    expect(await cancelBatch(ctx, batch.id)).toEqual({ cancelled: 0 });                  // cancelling again changes nothing
    // generating one card again afterwards joins the same run
    const [again] = await appendToBatch(ctx, batch.id, [job('b')]);
    expect(await db.get(P.batch(batch.id))).toMatchObject({ status: 'running', total: 5 });
    await completeJob(db, again, { kind: 'images', assetIds: [] });
    expect(await db.get(P.batch(batch.id))).toMatchObject({ status: 'cancelled', completed: 2, cancelled: 3, total: 5 });
  });
});
