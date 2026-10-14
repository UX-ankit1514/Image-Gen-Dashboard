/**
 * AI Connections (PRD §58–62), the companion protocol (§61), AI prompts and generation (§30–34).
 * The companion authenticates with its device token; no provider password, cookie or API key ever
 * reaches this server.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import {
  addReference, chooseProvider, claimCompanionJob, claimSignIn, composePreview, connectionsView, createConsistencyJob, createGenerateJobs, createPairingCode, createPromptJob,
  listSuggestions, resolveSuggestion,
  deviceFromToken, finishCompanionJob, finishSignIn, getCard, getConnections, getProject, heartbeat, P, pairDevice, queueIngest, recordGeneratedAsset,
  requestSignIn, revokeDevice, setProviderEnabled, useGenerated, type CompanionReport, type Device,
} from '@acs/firestore';
import { analysisTask, authorizeUrl, exchangeCode, oauthConfig, revokeToken, type AiTask } from '@acs/providers';
import { decryptJson, encryptJson, IMAGE_EXT, IMAGE_MIME, invalid, MAX_UPLOAD_BYTES, newId, notFound, nowIso, pkcePair, randomToken, sniffImage, UPLOAD_KINDS } from '@acs/shared';
import { enqueue } from '@acs/firestore';
import { projectKey } from '@acs/storage';
import { Scope, type Asset, type Batch, type Card, type Job, type ProviderConnection } from '@acs/types';
import { clients, ctxFor } from '../env';
import { body, type C, type HonoEnv } from '../http';

export const ai = new Hono<HonoEnv>();

// ---------------------------------------------------------------- connections (dashboard)
ai.get('/connections', async (c) => {
  const v = await connectionsView(ctxFor(c.env));
  return c.json({ ...v, oauth: { openai: !!oauthConfig(c.env) } });
});

ai.post('/connections/pairing-code', async (c) => c.json(await createPairingCode(ctxFor(c.env))));

/** "Sign in with ChatGPT": the paired companion opens ChatGPT's own sign-in page on the Mac. */
ai.post('/connections/openai/sign-in', async (c) => c.json({ ...await requestSignIn(ctxFor(c.env), 'openai'), oauth: { openai: !!oauthConfig(c.env) } }));

ai.post('/connections/:provider/:action{enable|disable}', async (c) => {
  const id = c.req.param('provider');
  if (id !== 'openai' && id !== 'claude') throw notFound('provider');
  const ctx = ctxFor(c.env);
  if (c.req.param('action') === 'disable') {
    // revoke cloud tokens on disconnect (PRD §62)
    const cur = (await getConnections(ctx)).find((x) => x.id === id) as ProviderConnection;
    const cfg = oauthConfig(c.env);
    if (cur?.tokens && cfg && c.env.TOKEN_KEY) {
      try {
        const t = await decryptJson<{ access_token: string; refresh_token?: string }>(c.env.TOKEN_KEY, cur.tokens);
        await revokeToken(cfg, t.refresh_token ?? t.access_token);
      } catch { /* revocation is best effort; the tokens are deleted either way */ }
    }
  }
  await setProviderEnabled(ctx, id, c.req.param('action') === 'enable');
  return c.json({ ok: true });
});

ai.post('/companion/devices/:id/revoke', async (c) => {
  await revokeDevice(ctxFor(c.env), c.req.param('id'));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- OpenAI cloud OAuth (scaffold, PRD §4.1)
ai.get('/connections/openai/oauth/start', async (c) => {
  const cfg = oauthConfig(c.env);
  if (!cfg || !c.env.TOKEN_KEY) return c.json({ error: 'Cloud sign-in with ChatGPT is not configured. Use the local companion.' }, 501);
  const ctx = ctxFor(c.env);
  const state = randomToken(24);
  const pkce = await pkcePair();
  const redirectUri = new URL('/api/connections/openai/oauth/callback', c.req.url).toString();
  await ctx.db.set(P.oauthState(state), { verifier: pkce.verifier, redirectUri, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });
  return c.redirect(authorizeUrl(cfg, { state, challenge: pkce.challenge, redirectUri }));
});

ai.get('/connections/openai/oauth/callback', async (c) => {
  const cfg = oauthConfig(c.env);
  const ctx = ctxFor(c.env);
  const state = c.req.query('state') ?? '';
  const code = c.req.query('code') ?? '';
  const rec = await ctx.db.get<{ verifier: string; redirectUri: string; expiresAt: string }>(P.oauthState(state));
  if (!cfg || !c.env.TOKEN_KEY || !rec || Date.parse(rec.expiresAt) < Date.now() || !code) return c.redirect('/connections?error=oauth');
  await ctx.db.delete(P.oauthState(state));
  const tokens = await exchangeCode(cfg, { code, verifier: rec.verifier, redirectUri: rec.redirectUri });
  const cur = (await getConnections(ctx)).find((x) => x.id === 'openai')!;
  await ctx.db.set(P.connection('openai'), {
    ...cur, mode: 'cloud-oauth', status: 'connected', planLabel: 'ChatGPT plan', tokens: await encryptJson(c.env.TOKEN_KEY, tokens),
    // capabilities of a cloud connection are whatever the approved integration grants; nothing assumed
    capabilities: { ...cur.capabilities, subscriptionBacked: true, cloudExecution: true }, updatedAt: nowIso(),
  });
  return c.redirect('/connections?connected=openai');
});

// ---------------------------------------------------------------- AI actions (dashboard)
ai.get('/jobs/:jid', async (c) => {
  const j = await ctxFor(c.env).db.get<Job>(P.job(c.req.param('jid')));
  if (!j) throw notFound('job');
  const { input, ...rest } = j;
  const meta = (input as { meta?: Record<string, unknown> })?.meta ?? {};
  // generated images arrive one by one; show them while the job runs
  const output = rest.output ?? (meta.assetIds && (meta.assetIds as string[]).length ? { kind: 'images', assetIds: meta.assetIds, partial: true } : null);
  return c.json({ ...rest, output });
});

async function previewUrlFor(c: C, card: Card) {
  return card.previewKey ? clients(c.env).storage.signedUrl(card.previewKey, 3600) : null;
}

ai.post('/ai/prompt', async (c) => {
  const b = await body(c, z.object({
    projectId: z.string(), cardId: z.string(), text: z.string().max(2000), scope: Scope, provider: z.enum(['openai', 'claude', 'auto']).optional(),
    intent: z.string().max(40).optional(), layerId: z.enum(['headline', 'subheading']).optional(),
    overrides: z.record(z.string(), z.unknown()).optional(), baseRev: z.string().optional(),
  }));
  const ctx = ctxFor(c.env);
  const projectId = b.projectId;
  const card = await getCard(ctx, projectId, b.cardId);
  const job = await createPromptJob(ctx, projectId, {
    cardId: b.cardId, text: b.text, intent: (b.intent ?? 'UNKNOWN') as never, layerId: b.layerId, provider: b.provider === 'auto' ? null : b.provider,
    overrides: b.overrides as never, baseRev: b.baseRev, previewUrl: b.intent === 'ANALYZE_CARD' ? await previewUrlFor(c, card) : null,
  });
  return c.json({ job }, 201);
});

async function assetUrlsFor(c: C, ids: string[]) {
  const ctx = ctxFor(c.env);
  const s = clients(c.env).storage;
  const assets = (await ctx.db.getMany<Asset>(ids.map((a) => P.asset(a)))).filter(Boolean) as Asset[];
  return Object.fromEntries(await Promise.all(assets.filter((a) => a.storageKey).map(async (a) => [a.id, await s.signedUrl(a.storageKey, 24 * 3600)] as const)));
}

ai.post('/ai/generate', async (c) => {
  const b = await body(c, z.object({
    projectId: z.string(), cardIds: z.array(z.string()).min(1).max(200), prompt: z.string().max(4000), variations: z.number().int().min(1).max(4),
    mode: z.enum(['generate', 'edit']), provider: z.enum(['openai', 'claude']).optional(), autoUse: z.boolean(),
    review: z.boolean().optional(), batchId: z.string().max(64).optional(),
  }));
  const ctx = ctxFor(c.env);
  const cards = (await ctx.db.getMany<Card>(b.cardIds.map((id) => P.card(b.projectId, id)))).filter(Boolean) as Card[];
  const urls = b.mode === 'edit' ? await assetUrlsFor(c, cards.map((x) => x.backgroundAssetId).filter(Boolean) as string[]) : {};
  return c.json(await createGenerateJobs(ctx, b.projectId, { ...b, urls }), 201);
});

/** A generation run for the review screen: each job with its card, the prompt it was given and the
 *  images it made so far. Nothing here is applied to a card until the person picks it. */
ai.get('/batches/:bid/generation', async (c) => {
  const ctx = ctxFor(c.env);
  const batch = await ctx.db.get<Batch>(P.batch(c.req.param('bid')));
  if (!batch || batch.kind !== 'generate') throw notFound('generation run');
  const jobs = (await ctx.db.getMany<Job>(batch.jobIds.map((id) => P.job(id)))).filter(Boolean) as Job[];
  return c.json({
    batch,
    jobs: jobs.map(({ input, ...j }) => {
      const meta = ((input as { meta?: Record<string, unknown> })?.meta ?? {}) as { request?: string; composedPrompt?: string; assetIds?: string[] };
      const out = j.output as { assetIds?: string[] } | null;
      return { ...j, request: meta.request ?? '', prompt: meta.composedPrompt ?? '', assetIds: out?.assetIds ?? meta.assetIds ?? [] };
    }),
  });
});

ai.post('/ai/compose', async (c) => {
  const b = await body(c, z.object({ projectId: z.string(), cardId: z.string(), prompt: z.string().max(4000), mode: z.enum(['generate', 'edit']) }));
  return c.json({ prompt: await composePreview(ctxFor(c.env), b.projectId, b.cardId, b.prompt, b.mode) });
});

ai.post('/projects/:pid/cards/:cid/use-generated', async (c) => {
  const b = await body(c, z.object({ assetId: z.string(), jobId: z.string().optional() }));
  const ctx = ctxFor(c.env);
  const job = b.jobId ? await ctx.db.get<Job>(P.job(b.jobId)) : null;
  const meta = (job?.input as { meta?: { request?: string } })?.meta;
  return c.json(await useGenerated(ctx, c.req.param('pid'), c.req.param('cid'), b.assetId, { prompt: meta?.request ?? undefined, provider: job?.provider ?? null, jobId: b.jobId ?? null }));
});

ai.post('/assets/:aid/reference', async (c) => {
  const b = await body(c, z.object({ projectId: z.string(), kind: z.enum(['approved', 'rejected', 'style', 'direction']), note: z.string().max(300).default('') }));
  return c.json(await addReference(ctxFor(c.env), b.projectId, c.req.param('aid'), b.kind, b.note));
});

/** Screenshot / image analysis with vision (PRD §16): describe, read visible text, flag text and logos. */
ai.post('/assets/:aid/analyze', async (c) => {
  const ctx = ctxFor(c.env);
  const a = await ctx.db.get<Asset>(P.asset(c.req.param('aid')));
  if (!a) throw notFound('asset');
  const project = a.projectId ? await getProject(ctx, a.projectId) : null;
  const conn = await chooseProvider(ctx, project?.provider ?? 'auto', 'visionAnalysis');
  const url = await clients(c.env).storage.signedUrl(a.previewKey ?? a.storageKey, 24 * 3600);
  const { task, post } = analysisTask(url);
  const job = await enqueue(ctx, { type: 'ai.vision', executor: 'companion', projectId: a.projectId, provider: conn.provider, input: { task, post, provider: conn.provider, meta: { assetId: a.id } } });
  return c.json({ job }, 201);
});

// ---------------------------------------------------------------- project intelligence (PRD §89–90)
ai.post('/projects/:pid/ai/consistency', async (c) => {
  const ctx = ctxFor(c.env);
  const s = clients(c.env).storage;
  const cards = (await ctx.db.query<Card>(P.cards(c.req.param('pid')), { orderBy: [['order', 'asc']] }))
    .filter((x) => x.status !== 'archived' && x.previewKey);
  const withUrls = await Promise.all(cards.map(async (x) => ({ id: x.id, name: x.name, url: await s.signedUrl(x.previewKey!, 24 * 3600) })));
  return c.json({ job: await createConsistencyJob(ctx, c.req.param('pid'), withUrls) }, 201);
});

ai.get('/projects/:pid/suggestions', async (c) => c.json(await listSuggestions(ctxFor(c.env), c.req.param('pid'))));

ai.post('/projects/:pid/suggestions/:sid', async (c) => {
  const b = await body(c, z.object({ status: z.enum(['accepted_card', 'accepted_project', 'accepted_template', 'ignored']) }));
  return c.json(await resolveSuggestion(ctxFor(c.env), c.req.param('pid'), c.req.param('sid'), b.status));
});

// ---------------------------------------------------------------- the companion (device token)
async function device(c: C): Promise<Device> {
  const auth = c.req.header('authorization') ?? '';
  const d = await deviceFromToken(ctxFor(c.env, 'companion'), auth.replace(/^Bearer\s+/i, '') || undefined);
  if (!d) throw Object.assign(invalid('This companion is not paired. Run the pairing again.'), { status: 401 });
  return d;
}

ai.post('/companion/pair', async (c) => {
  const b = await body(c, z.object({ code: z.string().min(6).max(12), name: z.string().max(80), platform: z.string().max(40) }));
  return c.json(await pairDevice(ctxFor(c.env, 'companion'), b.code, b.name, b.platform), 201);
});

const cli = z.object({ installed: z.boolean(), version: z.string().nullable(), loggedIn: z.boolean(), authMethod: z.string().nullable(), plan: z.string().nullable(), account: z.string().nullable(), subscriptionBacked: z.boolean() });

ai.post('/companion/heartbeat', async (c) => {
  const d = await device(c);
  const b = await body(c, z.object({ version: z.string().max(40), claude: cli, codex: cli.extend({ imageVerified: z.boolean().nullable() }) }));
  await heartbeat(ctxFor(c.env, `device:${d.id}`), d, b as CompanionReport);
  return c.json({ ok: true, at: nowIso() });
});

ai.post('/companion/jobs/next', async (c) => {
  const d = await device(c);
  const b = await body(c, z.object({ types: z.array(z.enum(['ai.text', 'ai.vision', 'ai.image', 'ai.classify'])), providers: z.array(z.enum(['openai', 'claude'])) }));
  const ctx = ctxFor(c.env, `device:${d.id}`);
  await ctx.db.update(P.device(d.id), { lastSeenAt: nowIso() });
  const conns = await getConnections(ctx);
  // a sign-in asked for in the dashboard comes first: nothing else can run until the CLI is signed in
  const signIn = await claimSignIn(ctx, conns, d.id);
  if (signIn) return c.json({ job: null, signIn });
  const enabled = new Set(conns.filter((x) => x.status !== 'disconnected' && !(x as { disabled?: boolean }).disabled).map((x) => x.id));
  const job = await claimCompanionJob(ctx.db, d.id, b.types);
  if (!job) return c.json({ job: null });
  const provider = (job.input as { provider: 'openai' | 'claude' }).provider;
  if (!b.providers.includes(provider) || !enabled.has(provider)) {
    // this companion can't serve it: put it back
    await ctx.db.update(P.job(job.id), { status: 'queued', claimedBy: null });
    return c.json({ job: null });
  }
  return c.json({ job: { id: job.id, type: job.type, provider, task: (job.input as { task: AiTask }).task } });
});

/** The companion asks while a job runs: a run cancelled from the dashboard stops the image in progress. */
ai.post('/companion/sign-in/result', async (c) => {
  const d = await device(c);
  const b = await body(c, z.object({ provider: z.literal('openai'), ok: z.boolean(), message: z.string().max(500).nullable().optional() }));
  await finishSignIn(ctxFor(c.env, `device:${d.id}`), d.id, b.ok, b.message ?? null);
  return c.json({ ok: true });
});

ai.post('/companion/jobs/:jid/state', async (c) => {
  const d = await device(c);
  const ctx = ctxFor(c.env, `device:${d.id}`);
  const job = await ctx.db.get<Job>(P.job(c.req.param('jid')));
  if (!job || job.claimedBy !== d.id) throw invalid('That job is not running on this companion.');
  return c.json({ cancelled: job.status === 'cancelled' });
});

ai.post('/companion/jobs/:jid/files', async (c) => {
  const d = await device(c);
  const ctx = ctxFor(c.env, `device:${d.id}`);
  const job = await ctx.db.get<Job>(P.job(c.req.param('jid')));
  if (!job || job.claimedBy !== d.id || job.status !== 'running') throw invalid('That job is not running on this companion.');
  const form = await c.req.parseBody();
  const file = form.file;
  if (!(file instanceof File) || file.size > MAX_UPLOAD_BYTES) throw invalid('Missing or oversized image.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind || !UPLOAD_KINDS.includes(kind)) throw invalid('Generated file is not a PNG/JPG/WebP image.');
  const id = newId('ast');
  const projectId = job.projectId!;
  const key = projectKey(ctx.ws, projectId, 'generated', `${id}.${IMAGE_EXT[kind]}`);
  await clients(c.env).storage.put(key, bytes, IMAGE_MIME[kind]);
  const meta = (job.input as { meta?: { request?: string; composedPrompt?: string; cardId?: string } }).meta ?? {};
  const asset: Asset = {
    id, workspaceId: ctx.ws, projectId, type: 'image', source: 'generated', role: null, sourcePageId: null, sourceUrl: null,
    name: `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, storageKey: key, thumbKey: null, previewKey: null,
    width: 0, height: 0, mimeType: IMAGE_MIME[kind], bytes: bytes.length, sha256: null, dhash: null, inkScore: null, flags: {},
    analysis: { description: meta.request || undefined, provider: job.provider ?? undefined }, status: 'pending', error: null, createdAt: nowIso(),
  };
  await recordGeneratedAsset(ctx, job, asset);
  await queueIngest(ctx, asset);
  return c.json({ assetId: id }, 201);
});

ai.post('/companion/jobs/:jid/result', async (c) => {
  const d = await device(c);
  const b = await body(c, z.object({
    ok: z.boolean(), json: z.unknown().optional(), text: z.string().max(200_000).optional(), imageUnavailable: z.boolean().optional(),
    error: z.object({ code: z.string().max(40), message: z.string().max(2000), resetAt: z.string().nullable().optional() }).optional(),
  }));
  const ctx = ctxFor(c.env, `device:${d.id}`);
  const job = await ctx.db.get<Job>(P.job(c.req.param('jid')));
  if (!job || job.claimedBy !== d.id) throw invalid('That job is not running on this companion.');
  const r = await finishCompanionJob(ctx, job.id, b);
  return c.json({ status: r.status });
});

