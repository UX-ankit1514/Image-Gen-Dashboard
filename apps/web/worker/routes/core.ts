/** Projects, scans, pages, cards, versions, review, batch, assets, jobs, exports, inbox, templates. */
import { Hono } from 'hono';
import { z } from 'zod';
import {
  activeJobs, approveCard, buildInbox, cancelBatch, cancelJob, commitVersion, createBlankCard, createCardsFromPages, createExport,
  createProject, duplicateCard, duplicateProject, getCard, getCardBundle, getProject, getRecipe, getRevision, getScan,
  listAssets, listCards, listExports, listPages, listProjects, listRecipes, listScans, listVersions, P, queueIngest,
  recentAudit, recomputeStats, rejectCard, renameCard, restoreVersion, retryFailed, retryJob, runBatch, saveDraft,
  seedRecipes, setCardStatus, startScan, updateProject, createAssetDoc, importLegacyRecords, chooseProvider, enqueue, type RecipeDoc,
} from '@acs/firestore';
import { DIMENSION_PRESETS, GRADIENT_PRESETS, RECIPES } from '@acs/renderer';
import { analysisTask } from '@acs/providers';
import { invalid, MAX_UPLOAD_BYTES, newId, notFound, nowIso, sniffImage, UPLOAD_KINDS, IMAGE_EXT, IMAGE_MIME, DEFAULT_NAMING, matchUploads } from '@acs/shared';
import { projectKey } from '@acs/storage';
import {
  BatchBody, CommitVersionBody, CreateBlankCardBody, CreateCardsBody, CreateProjectBody, ExportBody, RejectBody, REJECT_TAGS,
  SaveDraftBody, StartScanBody, UpdateProjectBody, CARD_STATUS_LABEL, INBOX_CATEGORIES,
  type Asset, type Batch, type Card, type ExportRecord, type Job, type Project, type SourceChange, type Workspace,
} from '@acs/types';
import { clients, ctxFor } from '../env';
import { body, type C, type HonoEnv } from '../http';
import { kickRunner, needsKick, scanNeedsKick } from '../runner';
import { assetUrls, cardUrls, designAssetIds, exportUrls, projectUrls, versionUrls } from '../urls';

export const core = new Hono<HonoEnv>();

// ---------------------------------------------------------------- bootstrap
core.get('/bootstrap', async (c) => {
  const ctx = ctxFor(c.env);
  let ws = await ctx.db.get<Workspace>(P.workspace());
  if (!ws) {
    ws = { id: ctx.ws, name: 'Arnifi', members: { owner: 'owner' }, settings: { namingTemplate: DEFAULT_NAMING, defaultProvider: 'auto' }, createdAt: nowIso() };
    await ctx.db.set(P.workspace(), ws);
    await seedRecipes(ctx);
  }
  const recipes = await listRecipes(ctx);
  return c.json({
    workspace: ws,
    recipes: recipes.map((r) => ({ id: r.id, name: r.name, description: r.description, width: r.width ?? r.base.canvas.width, height: r.height ?? r.base.canvas.height, builtin: r.builtin })),
    builtinRecipes: RECIPES.map((r) => r.id),
    gradientPresets: GRADIENT_PRESETS.map((p) => ({ id: p.id, name: p.name, description: p.description, editable: p.editable })),
    dimensionPresets: DIMENSION_PRESETS,
    rejectTags: REJECT_TAGS,
    statusLabels: CARD_STATUS_LABEL,
    inboxCategories: INBOX_CATEGORIES.map(({ key, label }) => ({ key, label })),
  });
});

core.patch('/workspace', async (c) => {
  const ctx = ctxFor(c.env);
  const b = await body(c, z.object({ namingTemplate: z.string().max(200).optional(), defaultProvider: z.enum(['chatgpt', 'claude', 'auto', 'none']).optional(), exportFormat: z.enum(['png', 'jpg', 'webp']).optional() }));
  const ws = await ctx.db.get<Workspace>(P.workspace());
  if (!ws) throw notFound('workspace');
  const settings = { ...ws.settings, ...b };
  await ctx.db.update(P.workspace(), { settings });
  return c.json({ ...ws, settings });
});

// ---------------------------------------------------------------- projects
core.get('/projects', async (c) => {
  const ctx = ctxFor(c.env);
  const list = await listProjects(ctx, c.req.query('archived') === '1');
  return c.json(await projectUrls(clients(c.env).storage, list));
});

core.post('/projects', async (c) => {
  const ctx = ctxFor(c.env);
  const b = await body(c, CreateProjectBody);
  const project = await createProject(ctx, b);
  const scan = b.urls?.filter((u) => u.trim()).length ? await startScan(ctx, project.id, b.urls) : null;
  return c.json({ project, scan }, 201);
});

core.get('/projects/:pid', async (c) => {
  const ctx = ctxFor(c.env);
  const project = await getProject(ctx, c.req.param('pid'));
  const rev = await getRevision(ctx, project.id, project.defaultsRev);
  const recipe = await getRecipe(ctx, project.recipeId);
  return c.json({ project: (await projectUrls(clients(c.env).storage, [project]))[0], base: rev.base, recipe: recipe ? { id: recipe.id, name: recipe.name } : null });
});

core.get('/projects/:pid/revisions/:rev', async (c) => {
  const r = await getRevision(ctxFor(c.env), c.req.param('pid'), c.req.param('rev'));
  return c.json(r);
});

core.patch('/projects/:pid', async (c) => {
  const ctx = ctxFor(c.env);
  const b = await body(c, UpdateProjectBody);
  return c.json(await updateProject(ctx, c.req.param('pid'), b as Partial<Project>));
});

core.post('/projects/:pid/rules', async (c) => {
  const ctx = ctxFor(c.env);
  const b = await body(c, z.object({ text: z.string().trim().min(2).max(300), source: z.enum(['manual', 'suggestion']).default('manual') }));
  const p = await getProject(ctx, c.req.param('pid'));
  const rules = [...(p.rules ?? []), { id: newId('rule'), text: b.text, source: b.source, createdAt: nowIso() }];
  await updateProject(ctx, p.id, { rules });
  return c.json({ rules });
});

core.delete('/projects/:pid/rules/:rid', async (c) => {
  const ctx = ctxFor(c.env);
  const p = await getProject(ctx, c.req.param('pid'));
  const rules = (p.rules ?? []).filter((r) => r.id !== c.req.param('rid'));
  await updateProject(ctx, p.id, { rules });
  return c.json({ rules });
});

core.post('/projects/:pid/duplicate', async (c) => {
  const ctx = ctxFor(c.env);
  const b = await body(c, z.object({ name: z.string().trim().min(1).max(120).optional() }));
  return c.json(await duplicateProject(ctx, c.req.param('pid'), b.name), 201);
});

// ---------------------------------------------------------------- scans & pages (PRD §13–15)
core.get('/projects/:pid/scans', async (c) => c.json(await listScans(ctxFor(c.env), c.req.param('pid'))));

core.post('/projects/:pid/scans', async (c) => {
  const b = await body(c, StartScanBody);
  const ctx = ctxFor(c.env);
  const prev = b.rescan ? (await listScans(ctx, c.req.param('pid')))[0] : null;
  return c.json(await startScan(ctx, c.req.param('pid'), b.urls, prev?.id ?? (b.rescan ? 'rescan' : null)), 201);
});

/** "Attach webpage URL" on a screenshot / upload card (PRD §16): scan it and link the card to the page. */
core.post('/projects/:pid/cards/:cid/attach', async (c) => {
  const b = await body(c, z.object({ url: z.string().max(2048) }));
  const ctx = ctxFor(c.env);
  await getCard(ctx, c.req.param('pid'), c.req.param('cid'));
  const scan = await startScan(ctx, c.req.param('pid'), [b.url]);
  await ctx.db.update(P.scan(scan.id), { attachTo: c.req.param('cid') });
  return c.json(scan, 201);
});

core.get('/scans/:sid', async (c) => {
  const ctx = ctxFor(c.env);
  const scan = await getScan(ctx, c.req.param('sid'));
  if (scanNeedsKick(scan)) kickRunner(c);
  const pages = scan.status === 'done' || scan.pages ? await listPages(ctx, scan.projectId, scan.id) : [];
  const assetIds = [...new Set(pages.flatMap((p) => p.images.map((i) => i.assetId).filter(Boolean)))] as string[];
  const assets = (await ctx.db.getMany<Asset>(assetIds.map((a) => P.asset(a)))).filter(Boolean) as Asset[];
  const batch = (scan as { ingestBatchId?: string }).ingestBatchId ? await ctx.db.get<Batch>(P.batch((scan as { ingestBatchId?: string }).ingestBatchId!)) : null;
  const cards = await listCards(ctx, scan.projectId);
  return c.json({ scan, pages, assets: await assetUrls(clients(c.env).storage, assets), ingest: batch, cardsByPage: Object.fromEntries(cards.filter((x) => x.sourcePageId).map((x) => [x.sourcePageId, x.id])) });
});

core.get('/projects/:pid/pages', async (c) => c.json(await listPages(ctxFor(c.env), c.req.param('pid'))));

core.get('/projects/:pid/changes', async (c) => {
  const ctx = ctxFor(c.env);
  return c.json(await ctx.db.query<SourceChange>(P.changes(c.req.param('pid')), { orderBy: [['createdAt', 'desc']], limit: 200 }));
});

core.post('/projects/:pid/changes/:chid', async (c) => {
  const ctx = ctxFor(c.env);
  const b = await body(c, z.object({ status: z.enum(['reviewed', 'ignored']) }));
  await ctx.db.update(P.change(c.req.param('pid'), c.req.param('chid')), { status: b.status });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- cards
core.get('/projects/:pid/cards', async (c) => {
  const ctx = ctxFor(c.env);
  return c.json(await cardUrls(clients(c.env).storage, await listCards(ctx, c.req.param('pid'))));
});

core.post('/projects/:pid/cards', async (c) => {
  const b = await body(c, CreateCardsBody);
  return c.json(await createCardsFromPages(ctxFor(c.env), c.req.param('pid'), b.pageIds, b.backgrounds ?? {}), 201);
});

core.post('/projects/:pid/cards/blank', async (c) => {
  const b = await body(c, CreateBlankCardBody);
  return c.json(await createBlankCard(ctxFor(c.env), c.req.param('pid'), b), 201);
});

/** Mixed uploads → pages (PRD §95): proposes, never applies on its own. */
core.post('/projects/:pid/match-uploads', async (c) => {
  const b = await body(c, z.object({ assetIds: z.array(z.string()).max(500) }));
  const ctx = ctxFor(c.env);
  const pages = await listPages(ctx, c.req.param('pid'));
  const assets = (await ctx.db.getMany<Asset>(b.assetIds.map((a) => P.asset(a)))).filter(Boolean) as Asset[];
  const res = matchUploads(assets.map((a) => a.name), pages.map((p) => ({ id: p.id, slug: p.slug, title: p.h1 || p.name })));
  return c.json(res.map((r, i) => ({ ...r, assetId: assets[i].id })));
});

core.post('/projects/:pid/import', async (c) => {
  const b = await body(c, z.object({ records: z.array(z.object({
    name: z.string().max(300), slug: z.string().max(200), h1: z.string().max(500), kicker: z.string().max(300), url: z.string().max(2048),
    country: z.string().nullable(), authority: z.string().nullable(), price: z.string().nullable(), estTime: z.string().nullable(), category: z.string().nullable(),
    highlights: z.array(z.object({ title: z.string(), desc: z.string() })).max(50), focus: z.string().max(40), image: z.string().nullable(),
    assetId: z.string(), finalAssetId: z.string().nullable(), position: z.number(),
  })).max(1000) }));
  return c.json(await importLegacyRecords(ctxFor(c.env), c.req.param('pid'), b.records), 201);
});

core.get('/projects/:pid/cards/:cid', async (c) => {
  const ctx = ctxFor(c.env);
  const s = clients(c.env).storage;
  const b = await getCardBundle(ctx, c.req.param('pid'), c.req.param('cid'));
  const ids = new Set(designAssetIds(b.design));
  for (const i of b.page?.images ?? []) if (i.assetId) ids.add(i.assetId);
  const assets = (await ctx.db.getMany<Asset>([...ids].map((a) => P.asset(a)))).filter(Boolean) as Asset[];
  return c.json({
    ...b,
    card: (await cardUrls(s, [b.card]))[0],
    versions: await versionUrls(s, b.versions),
    assets: await assetUrls(s, assets),
    project: (await projectUrls(s, [b.project]))[0],
  });
});

core.patch('/projects/:pid/cards/:cid', async (c) => {
  const ctx = ctxFor(c.env);
  const b = await body(c, z.object({ name: z.string().trim().min(1).max(160).optional(), status: z.enum(['draft', 'needs_review', 'archived']).optional() }));
  if (b.name) await renameCard(ctx, c.req.param('pid'), c.req.param('cid'), b.name);
  if (b.status) await setCardStatus(ctx, c.req.param('pid'), c.req.param('cid'), b.status);
  return c.json(await getCard(ctx, c.req.param('pid'), c.req.param('cid')));
});

core.put('/projects/:pid/cards/:cid/draft', async (c) => {
  const b = await body(c, SaveDraftBody);
  return c.json(await saveDraft(ctxFor(c.env), c.req.param('pid'), c.req.param('cid'), b.draft, b.baseRev));
});

core.post('/projects/:pid/cards/:cid/commit', async (c) => {
  const b = await body(c, CommitVersionBody);
  const r = await commitVersion(ctxFor(c.env), c.req.param('pid'), c.req.param('cid'), { reason: b.reason, prompt: b.prompt ?? null, provider: b.provider ?? null });
  return c.json(r);
});

core.post('/projects/:pid/cards/:cid/approve', async (c) => c.json(await approveCard(ctxFor(c.env), c.req.param('pid'), c.req.param('cid'))));

core.post('/projects/:pid/cards/:cid/reject', async (c) => {
  const b = await body(c, RejectBody);
  return c.json(await rejectCard(ctxFor(c.env), c.req.param('pid'), c.req.param('cid'), b.tags, b.text));
});

core.post('/projects/:pid/cards/:cid/restore/:vid', async (c) =>
  c.json(await restoreVersion(ctxFor(c.env), c.req.param('pid'), c.req.param('cid'), c.req.param('vid'))));

core.post('/projects/:pid/cards/:cid/duplicate', async (c) => {
  const b = await body(c, z.object({ versionId: z.string().optional() }));
  return c.json(await duplicateCard(ctxFor(c.env), c.req.param('pid'), c.req.param('cid'), b.versionId), 201);
});

core.get('/projects/:pid/cards/:cid/versions', async (c) =>
  c.json(await versionUrls(clients(c.env).storage, await listVersions(ctxFor(c.env), c.req.param('pid'), c.req.param('cid')))));

core.post('/projects/:pid/batch', async (c) => {
  const b = await body(c, BatchBody);
  return c.json(await runBatch(ctxFor(c.env), c.req.param('pid'), b));
});

/** "This background is used on 6 cards" (PRD §47). */
core.get('/projects/:pid/duplicates', async (c) => {
  const ctx = ctxFor(c.env);
  const cards = (await listCards(ctx, c.req.param('pid'))).filter((x) => x.status !== 'archived' && x.backgroundAssetId);
  const assets = await listAssets(ctx, c.req.param('pid'));
  const byId = new Map(assets.map((a) => [a.id, a]));
  const groups = new Map<string, Card[]>();
  for (const card of cards) {
    const a = byId.get(card.backgroundAssetId!);
    const key = a?.flags.duplicateOf ?? a?.sha256 ?? card.backgroundAssetId!;
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  const out = [...groups.entries()].filter(([, g]) => g.length > 1).map(([key, g]) => ({ key, assetId: g[0].backgroundAssetId, cardIds: g.map((x) => x.id), names: g.map((x) => x.name) }));
  return c.json(out);
});

// ---------------------------------------------------------------- assets (PRD §16, §46)
core.get('/projects/:pid/assets', async (c) => c.json(await assetUrls(clients(c.env).storage, await listAssets(ctxFor(c.env), c.req.param('pid')))));
core.get('/assets', async (c) => c.json(await assetUrls(clients(c.env).storage, await listAssets(ctxFor(c.env), null))));

core.post('/assets/resolve', async (c) => {
  const b = await body(c, z.object({ ids: z.array(z.string()).max(200) }));
  const ctx = ctxFor(c.env);
  const assets = (await ctx.db.getMany<Asset>(b.ids.map((a) => P.asset(a)))).filter(Boolean) as Asset[];
  return c.json(await assetUrls(clients(c.env).storage, assets));
});

/** Upload or paste: PNG/JPG/WebP only, ≤ 25 MB, checked by content (PRD §16, §78). */
async function upload(c: C, projectId: string | null) {
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File)) throw invalid('No file in the upload.');
  if (file.size > MAX_UPLOAD_BYTES) throw invalid('The file is larger than 25 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const purpose = String(form.purpose ?? 'upload');
  const kind = sniffImage(bytes);
  // people upload PNG/JPG/WebP (PRD §16); imported runs may also hold AVIF/GIF, which ingest converts
  const allowed = purpose === 'import' || purpose === 'reference' ? [...UPLOAD_KINDS, 'avif', 'gif'] : UPLOAD_KINDS;
  if (!kind || !allowed.includes(kind)) throw invalid('That file type is not supported. Use PNG, JPG or WebP.');
  const source = purpose === 'screenshot' ? 'screenshot' : purpose === 'logo' || purpose === 'gradient' ? 'global' : purpose === 'import' ? 'import' : 'upload';
  const ctx = ctxFor(c.env);
  const id = newId('ast');
  const key = projectId ? projectKey(ctx.ws, projectId, purpose === 'reference' ? 'references' : 'uploaded', `${id}.${IMAGE_EXT[kind]}`) : `ws/${ctx.ws}/global/${id}.${IMAGE_EXT[kind]}`;
  await clients(c.env).storage.put(key, bytes, IMAGE_MIME[kind]);
  const name = (file.name || `${purpose}.${IMAGE_EXT[kind]}`).replace(/[^\w.\- ()&]+/g, '_').slice(0, 120);
  const asset = await createAssetDoc(ctx, {
    id, projectId, type: purpose === 'screenshot' ? 'screenshot' : purpose === 'reference' ? 'reference' : purpose === 'logo' ? 'logo' : purpose === 'gradient' ? 'gradient' : 'image',
    source, role: null, sourcePageId: null, sourceUrl: null, name, storageKey: key, thumbKey: null, previewKey: null,
    width: 0, height: 0, mimeType: IMAGE_MIME[kind], bytes: bytes.length, sha256: null, dhash: null, inkScore: null, flags: {},
    analysis: null, status: 'pending', error: null,
  } as Omit<Asset, 'id' | 'workspaceId' | 'createdAt'> & { id: string });
  await queueIngest(ctx, asset);
  if (purpose === 'screenshot' && projectId) {
    // a pasted screenshot gets a visual read when AI is connected (PRD §16); never required
    try {
      const project = await getProject(ctx, projectId);
      const conn = await chooseProvider(ctx, project.provider, 'visionAnalysis');
      const { task, post } = analysisTask(await clients(c.env).storage.signedUrl(key, 24 * 3600));
      await enqueue(ctx, { type: 'ai.vision', executor: 'companion', projectId, provider: conn.provider, input: { task, post, provider: conn.provider, meta: { assetId: asset.id } } });
    } catch { /* no vision-capable connection: fine */ }
  }
  return (await assetUrls(clients(c.env).storage, [asset]))[0];
}

core.post('/projects/:pid/assets', async (c) => c.json(await upload(c, c.req.param('pid')), 201));
core.post('/assets', async (c) => c.json(await upload(c, null), 201));

core.patch('/assets/:aid', async (c) => {
  const ctx = ctxFor(c.env);
  const b = await body(c, z.object({ name: z.string().trim().min(1).max(160).optional(), keepDuplicate: z.boolean().optional(), type: z.enum(['image', 'reference', 'logo']).optional() }));
  const a = await ctx.db.get<Asset>(P.asset(c.req.param('aid')));
  if (!a) throw notFound('asset');
  const patch: Partial<Asset> = {};
  if (b.name) patch.name = b.name;
  if (b.type) patch.type = b.type;
  if (b.keepDuplicate) patch.flags = { ...a.flags, duplicateOf: null };
  await ctx.db.update(P.asset(a.id), patch);
  return c.json({ ...a, ...patch });
});

// ---------------------------------------------------------------- jobs (PRD §64)
core.get('/projects/:pid/jobs', async (c) => {
  const ctx = ctxFor(c.env);
  const jobs = await activeJobs(ctx.db, c.req.param('pid'));
  // what the strips show: the last day of runs (each document read counts against the free quota)
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const batches = await ctx.db.query<Batch>(P.batches, { where: [['projectId', '==', c.req.param('pid')], ['createdAt', '>=', since]], orderBy: [['createdAt', 'desc']], limit: 20 });
  if (jobs.some(needsKick)) kickRunner(c);
  return c.json({ jobs: jobs.map(({ input: _i, ...rest }) => rest), batches });
});

core.post('/jobs/:jid/retry', async (c) => c.json(await retryJob(ctxFor(c.env), c.req.param('jid'))));
core.post('/jobs/:jid/cancel', async (c) => c.json(await cancelJob(ctxFor(c.env), c.req.param('jid'))));
core.post('/batches/:bid/cancel', async (c) => c.json(await cancelBatch(ctxFor(c.env), c.req.param('bid')) ?? { cancelled: 0 }));
core.post('/batches/:bid/retry-failed', async (c) => c.json({ retried: await retryFailed(ctxFor(c.env), c.req.param('bid')) }));

// ---------------------------------------------------------------- exports (PRD §67–69)
core.post('/projects/:pid/exports', async (c) => {
  const b = await body(c, ExportBody);
  return c.json(await createExport(ctxFor(c.env), c.req.param('pid'), b), 201);
});

core.get('/exports', async (c) => {
  const ctx = ctxFor(c.env);
  const list = await listExports(ctx, c.req.query('projectId') || undefined);
  const names = new Map((await listProjects(ctx, true)).map((p) => [p.id, p.name]));
  const s = clients(c.env).storage;
  return c.json(await Promise.all(list.map(async (e) => ({ ...(await exportUrls(s, e, names.get(e.projectId))), projectName: names.get(e.projectId) ?? '' }))));
});

core.get('/exports/:eid', async (c) => {
  const ctx = ctxFor(c.env);
  const e = await ctx.db.get<ExportRecord>(P.export(c.req.param('eid')));
  if (!e) throw notFound('export');
  if (e.status === 'queued' && Date.now() - Date.parse(e.createdAt) > 8_000) kickRunner(c);
  const p = await ctx.db.get<Project>(P.project(e.projectId));
  return c.json(await exportUrls(clients(c.env).storage, e, p?.name));
});

// ---------------------------------------------------------------- review inbox (PRD §48)
core.get('/inbox', async (c) => {
  const ctx = ctxFor(c.env);
  const items = await buildInbox(ctx);
  const s = clients(c.env).storage;
  return c.json(await Promise.all(items.map(async (i) => ({ ...i, thumbUrl: i.thumbKey ? await s.signedUrl(i.thumbKey) : null }))));
});

// ---------------------------------------------------------------- templates (PRD §38)
core.get('/recipes', async (c) => c.json(await listRecipes(ctxFor(c.env))));

core.get('/recipes/:id', async (c) => {
  const r = await getRecipe(ctxFor(c.env), c.req.param('id'));
  if (!r) throw notFound('template');
  return c.json(r);
});

core.post('/recipes', async (c) => {
  const ctx = ctxFor(c.env);
  const b = await body(c, z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(400).optional(), fromProjectId: z.string().optional(), fromRecipeId: z.string().optional() }));
  let base;
  if (b.fromProjectId) {
    const p = await getProject(ctx, b.fromProjectId);
    base = (await getRevision(ctx, p.id, p.defaultsRev)).base;
  } else {
    const src = await getRecipe(ctx, b.fromRecipeId ?? 'arnifi-light');
    if (!src) throw notFound('template');
    base = src.base;
  }
  const t = nowIso();
  const r: RecipeDoc = { id: newId('rcp'), name: b.name, description: b.description ?? '', builtin: false, base, width: base.canvas.width, height: base.canvas.height, createdAt: t, updatedAt: t };
  await ctx.db.set(P.recipe(r.id), r);
  return c.json(r, 201);
});

core.patch('/recipes/:id', async (c) => {
  const ctx = ctxFor(c.env);
  const b = await body(c, z.object({ name: z.string().trim().min(1).max(80).optional(), description: z.string().max(400).optional(), brief: z.string().max(4000).optional(), negativeConstraints: z.array(z.string().max(300)).max(40).optional() }));
  const r = await getRecipe(ctx, c.req.param('id'));
  if (!r) throw notFound('template');
  const next = { ...r, ...b, updatedAt: nowIso() };
  await ctx.db.set(P.recipe(r.id), next);
  return c.json(next);
});

// ---------------------------------------------------------------- activity
core.get('/audit', async (c) => c.json(await recentAudit(ctxFor(c.env), 200)));

core.get('/stats', async (c) => {
  // PRD §83 success metrics, from audit events and job timestamps
  const ctx = ctxFor(c.env);
  const [events, projects] = await Promise.all([recentAudit(ctx, 1000), listProjects(ctx, true)]);
  const jobs = await ctx.db.query<Job>(P.jobs, { orderBy: [['createdAt', 'desc']], limit: 1000 });
  const count = (t: string) => events.filter((e) => e.type === t).length;
  const finished = jobs.filter((j) => j.status === 'completed' || j.status === 'failed');
  const failRate = (type: string) => {
    const f = finished.filter((j) => j.type === type);
    return f.length ? f.filter((j) => j.status === 'failed').length / f.length : null;
  };
  const firstCard = projects.map((p) => {
    const scan = events.find((e) => e.type === 'scan.started' && e.entityId === p.id);
    const cards = events.filter((e) => e.type === 'cards.created' && e.entityId === p.id).pop();
    return scan && cards ? (Date.parse(cards.createdAt) - Date.parse(scan.createdAt)) / 1000 : null;
  }).filter((x): x is number => x !== null && x >= 0);
  return c.json({
    projects: projects.length, approvals: count('card.approved'), rejections: count('card.rejected'), exports: count('export.created'),
    medianSecondsUrlToCards: firstCard.length ? firstCard.sort((a, b) => a - b)[Math.floor(firstCard.length / 2)] : null,
    renderFailureRate: failRate('render'), exportFailureRate: failRate('export'), ingestFailureRate: failRate('ingest'),
    aiJobs: finished.filter((j) => j.type.startsWith('ai.')).length,
  });
});

export async function touchStats(env: HonoEnv['Bindings'], pid: string) {
  await recomputeStats(ctxFor(env), pid);
}
