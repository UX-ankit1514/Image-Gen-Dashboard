/**
 * AI connections and AI jobs (PRD §4–6, §58–62, §87–88).
 *
 * The Local Companion pairs with a 6-digit code shown in the dashboard; it gets a device token whose
 * hash is the only thing stored. Its heartbeat reports which official CLIs are installed and how they
 * are signed in; only subscription sign-ins count (Claude Code with claude.ai, Codex with ChatGPT).
 * Capabilities come from that report — detected, never assumed.
 */
import { CLAUDE_CAPS, CODEX_CAPS, compact, consistencyTask, imageTask, textTask, type AiTask, type DetectedCli, type PostKind, type TaskContext } from '@acs/providers';
import { applyOverrides, replaceBackground } from '@acs/renderer';
import { invalid, newId, notFound, nowIso, pairingCode, randomToken, sha256Text } from '@acs/shared';
import {
  NO_CAPABILITIES,
  type Asset, type Card, type CardVersion, type Design, type Feedback, type Intent, type Job, type Overrides, type Project,
  type ProviderConnection, type ProviderId, type Reference, type SourcePage, type Suggestion,
} from '@acs/types';
import { P } from '../paths';
import { audit } from './audit';
import { commitVersion, designOfVersion, getCard, revisionCached } from './cards';
import type { Ctx } from './context';
import { appendToBatch, completeJob, enqueue, enqueueBatch, failJob, pauseJob } from './jobs';
import { getProject } from './projects';
import { getRecipe } from './recipes';

export interface Device {
  id: string;
  name: string;
  platform: string;
  tokenHash: string;
  pairedAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  report: CompanionReport | null;
}

export interface CompanionReport {
  version: string;
  claude: DetectedCli;
  codex: DetectedCli & { imageVerified: boolean | null };
}

const ONLINE_MS = 3 * 60_000;

function emptyConnection(id: ProviderId): ProviderConnection {
  return { id, provider: id, mode: 'local-companion', status: 'disconnected', planLabel: null, accountLabel: null, capabilities: NO_CAPABILITIES,
    deviceId: null, cli: null, usageLimit: null, lastCheckedAt: null, updatedAt: nowIso() };
}

export async function getConnections(ctx: Ctx) {
  const rows = await ctx.db.getMany<ProviderConnection & { disabled?: boolean }>([P.connection('openai'), P.connection('claude')]);
  return [rows[0] ?? emptyConnection('openai'), rows[1] ?? emptyConnection('claude')];
}

/** How long a sign-in may wait for the companion to pick it up, and for the person to finish it. */
const SIGN_IN_PICKUP_MS = 2 * 60_000;
const SIGN_IN_OPEN_MS = 6 * 60_000;

/** A sign-in nobody finished is shown as failed, without writing anything. */
function signInView(s: ProviderConnection['signIn']): ProviderConnection['signIn'] {
  if (!s) return null;
  const age = Date.now() - Date.parse(s.at);
  if (s.state === 'requested' && age > SIGN_IN_PICKUP_MS) return { ...s, state: 'failed', message: "The companion didn't pick up the sign-in. Check that it is running on your Mac, then try again." };
  if (s.state === 'opened' && age > SIGN_IN_OPEN_MS) return { ...s, state: 'failed', message: 'The ChatGPT sign-in was not finished. Try again.' };
  return s;
}

export async function connectionsView(ctx: Ctx) {
  const [connections, devices] = await Promise.all([getConnections(ctx), ctx.db.query<Device>(P.devices)]);
  const live = devices.filter((d) => !d.revokedAt);
  const online = live.some((d) => d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < ONLINE_MS);
  // a companion that went quiet can't run anything: show it, don't pretend
  const shown = connections.map((c) => (c.mode === 'local-companion' && c.status === 'connected' && !online ? { ...c, status: 'unavailable' as const } : c))
    .map(({ tokens: _t, ...rest }) => ({ ...rest, signIn: signInView(rest.signIn) }));
  return {
    connections: shown,
    companion: {
      paired: live.length > 0, online,
      devices: live.map((d) => ({ id: d.id, name: d.name, platform: d.platform, lastSeenAt: d.lastSeenAt, version: d.report?.version ?? null, codexInstalled: d.report?.codex.installed ?? null })),
    },
  };
}

// ---------------------------------------------------------------- "Sign in with ChatGPT" via the companion
/** The dashboard asks; the companion on the Mac opens ChatGPT's own sign-in page there (`codex login`).
 *  Nothing about the sign-in passes through Creative Studio: it only learns, from the next heartbeat,
 *  that the CLI is signed in with a ChatGPT plan. */
export async function requestSignIn(ctx: Ctx, id: ProviderId) {
  if (id !== 'openai') throw invalid('Only ChatGPT can be signed in from here.');
  const view = await connectionsView(ctx);
  if (!view.companion.online) throw invalid('Start the companion on your Mac first, then sign in.');
  const [openai] = await getConnections(ctx);
  const { disabled: _d, ...cur } = openai as ProviderConnection & { disabled?: boolean };
  await ctx.db.set(P.connection('openai'), { ...cur, signIn: { state: 'requested', at: nowIso(), deviceId: null, message: null }, updatedAt: nowIso() });
  return connectionsView(ctx);
}

/** The companion's poll: a pending sign-in goes to exactly one companion. */
export async function claimSignIn(ctx: Ctx, conns: ProviderConnection[], deviceId: string): Promise<ProviderId | null> {
  const s = conns.find((c) => c.id === 'openai')?.signIn;
  if (!s || s.state !== 'requested' || Date.now() - Date.parse(s.at) > SIGN_IN_PICKUP_MS) return null;
  return ctx.db.transaction(async (tx) => {
    const fresh = await tx.get<ProviderConnection>(P.connection('openai'));
    if (fresh?.signIn?.state !== 'requested') return null;
    tx.update(P.connection('openai'), { signIn: { ...fresh.signIn, state: 'opened', deviceId, at: nowIso() } });
    return 'openai' as const;
  });
}

/** The CLI's sign-in ended. On success the heartbeat the companion sends first has already marked it connected. */
export async function finishSignIn(ctx: Ctx, deviceId: string, ok: boolean, message: string | null) {
  const [openai] = await getConnections(ctx);
  if (openai.signIn?.deviceId !== deviceId) return;
  await ctx.db.update(P.connection('openai'), { signIn: ok ? null : { ...openai.signIn, state: 'failed', at: nowIso(), message: message ?? 'The ChatGPT sign-in did not finish. Try again.' }, updatedAt: nowIso() });
}

// ---------------------------------------------------------------- pairing (PRD §61)
export async function createPairingCode(ctx: Ctx) {
  const code = pairingCode();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await ctx.db.set(P.pairing(await sha256Text(code)), { createdAt: nowIso(), expiresAt, used: false });
  return { code, expiresAt };
}

export async function pairDevice(ctx: Ctx, code: string, name: string, platform: string) {
  const hash = await sha256Text(code.replace(/\D/g, ''));
  const rec = await ctx.db.get<{ expiresAt: string; used: boolean }>(P.pairing(hash));
  if (!rec || rec.used || Date.parse(rec.expiresAt) < Date.now()) throw invalid('That pairing code is not valid any more. Show a new one in AI Connections.');
  const token = randomToken(32);
  const device: Device = { id: newId('dev'), name: name.slice(0, 80) || 'Companion', platform: platform.slice(0, 40), tokenHash: await sha256Text(token), pairedAt: nowIso(), lastSeenAt: nowIso(), revokedAt: null, report: null };
  await ctx.db.commit([
    { kind: 'update', path: P.pairing(hash), data: { used: true } },
    { kind: 'create', path: P.device(device.id), data: device },
  ]);
  await audit(ctx, 'companion.paired', 'device', device.id, { name: device.name, platform });
  return { deviceId: device.id, token };
}

export async function deviceFromToken(ctx: Ctx, token: string | undefined) {
  if (!token) return null;
  const hash = await sha256Text(token);
  const [d] = await ctx.db.query<Device>(P.devices, { where: [['tokenHash', '==', hash]], limit: 1 });
  return d && !d.revokedAt ? d : null;
}

export async function revokeDevice(ctx: Ctx, id: string) {
  await ctx.db.update(P.device(id), { revokedAt: nowIso() });
  for (const c of await getConnections(ctx)) {
    if (c.deviceId === id) await ctx.db.set(P.connection(c.id), { ...c, status: 'disconnected', capabilities: NO_CAPABILITIES, deviceId: null, updatedAt: nowIso() });
  }
  await audit(ctx, 'companion.revoked', 'device', id);
}

/** The companion's heartbeat: what is installed and how it is signed in. */
export async function heartbeat(ctx: Ctx, device: Device, report: CompanionReport) {
  const t = nowIso();
  await ctx.db.update(P.device(device.id), { lastSeenAt: t, report });
  const [openai, claude] = await getConnections(ctx);
  const next = (cur: ProviderConnection & { disabled?: boolean }, id: ProviderId, d: DetectedCli, caps: ProviderConnection['capabilities']): ProviderConnection => {
    const refused = d.installed && d.loggedIn && !d.subscriptionBacked;
    const status = cur.disabled ? 'disconnected' : !d.installed || !d.loggedIn ? 'disconnected' : refused ? 'limited' : cur.usageLimit?.reached ? 'limited' : 'connected';
    const wasConnected = cur.status === 'connected';
    const out: ProviderConnection = {
      ...cur, id, provider: id, mode: 'local-companion', status, deviceId: device.id,
      capabilities: status === 'connected' || (status === 'limited' && !refused) ? caps : NO_CAPABILITIES,
      planLabel: id === 'openai' ? (d.subscriptionBacked ? 'ChatGPT plan' : null) : d.plan ? `Claude ${d.plan[0].toUpperCase()}${d.plan.slice(1)}` : 'Claude plan',
      accountLabel: d.account, cli: { installed: d.installed, version: d.version, authMethod: d.authMethod },
      usageLimit: cur.usageLimit?.reached && cur.usageLimit.resetAt && Date.parse(cur.usageLimit.resetAt) < Date.now() ? null : cur.usageLimit,
      lastCheckedAt: t, updatedAt: t,
    };
    if (refused) out.usageLimit = { reached: false, resetAt: null, message: `${id === 'claude' ? 'Claude Code' : 'Codex'} is signed in with an API key. Creative Studio only uses your subscription sign-in, so it won't use this connection.` };
    if (!wasConnected && status === 'connected') void audit(ctx, 'provider.connected', 'provider', id, { via: 'companion', device: device.id });
    return out;
  };
  await ctx.db.set(P.connection('openai'), next(openai, 'openai', report.codex, CODEX_CAPS(report.codex, report.codex.imageVerified)));
  await ctx.db.set(P.connection('claude'), next(claude, 'claude', report.claude, CLAUDE_CAPS(report.claude)));
}

export async function setProviderEnabled(ctx: Ctx, id: ProviderId, enabled: boolean) {
  const [openai, claude] = await getConnections(ctx);
  const cur = id === 'openai' ? openai : claude;
  await ctx.db.set(P.connection(id), { ...cur, disabled: !enabled, status: enabled ? cur.status : 'disconnected', capabilities: enabled ? cur.capabilities : NO_CAPABILITIES, tokens: enabled ? cur.tokens ?? null : null, updatedAt: nowIso() });
  await audit(ctx, enabled ? 'provider.connected' : 'provider.disconnected', 'provider', id, {});
}

// ---------------------------------------------------------------- AI jobs
type Need = 'textGeneration' | 'visionAnalysis' | 'imageGeneration' | 'imageEditing';

/** Picks a connected provider with the capability. Never falls back to anything billed (Rule 10). */
export async function chooseProvider(ctx: Ctx, choice: string, need: Need, requested?: string | null) {
  if (choice === 'none') throw invalid('AI is switched off for this project. Change it in the project settings.');
  const conns = (await connectionsView(ctx)).connections;
  const usable = conns.filter((c) => c.status === 'connected' && c.capabilities[need]);
  const order: ProviderId[] = requested === 'openai' || requested === 'claude' ? [requested] : choice === 'claude' ? ['claude'] : choice === 'chatgpt' ? ['openai'] : need === 'imageGeneration' || need === 'imageEditing' ? ['openai', 'claude'] : ['claude', 'openai'];
  for (const id of order) {
    const c = usable.find((x) => x.provider === id);
    if (c) return c;
  }
  const what = need === 'imageGeneration' ? 'Image generation' : need === 'imageEditing' ? 'Image editing' : 'AI';
  throw invalid(`${what} is unavailable on the connected providers. Open AI Connections to connect ChatGPT or Claude.`);
}

async function cardContext(ctx: Ctx, project: Project, card: Card, overrides?: Overrides | null, baseRev?: string | null): Promise<{ design: Design; page: SourcePage | null; rejections: Feedback[]; lastPrompt: string | null }> {
  const v = card.currentVersionId ? await ctx.db.get<CardVersion>(P.version(project.id, card.id, card.currentVersionId)) : null;
  let design: Design;
  if (overrides && baseRev) design = applyOverrides((await revisionCached(ctx, project.id, baseRev)).base, overrides);
  else if (v) design = await designOfVersion(ctx, v);
  else throw invalid('This card has no design yet.');
  const page = card.sourcePageId ? await ctx.db.get<SourcePage>(P.page(project.id, card.sourcePageId)) : null;
  const rejections = (await ctx.db.query<Feedback>(P.feedback(project.id, card.id), { orderBy: [['createdAt', 'desc']], limit: 20 })).filter((f) => f.kind === 'reject');
  const versions = await ctx.db.query<CardVersion>(P.versions(project.id, card.id), { orderBy: [['number', 'desc']], limit: 20 });
  return { design, page, rejections, lastPrompt: versions.find((x) => x.prompt)?.prompt ?? null };
}

export interface PromptJobInput {
  cardId: string;
  text: string;
  intent: Intent | 'UNKNOWN';
  layerId?: 'headline' | 'subheading';
  provider?: string | null;
  overrides?: Overrides | null;
  baseRev?: string | null;
  previewUrl?: string | null;
}

export async function createPromptJob(ctx: Ctx, projectId: string, input: PromptJobInput) {
  const project = await getProject(ctx, projectId);
  const card = await getCard(ctx, projectId, input.cardId);
  const intent: Intent = (['EDIT_COPY', 'EDIT_GRADIENT', 'ANALYZE_CARD'] as string[]).includes(input.intent) ? (input.intent as Intent) : 'UNKNOWN';
  const need: Need = intent === 'ANALYZE_CARD' && input.previewUrl ? 'visionAnalysis' : 'textGeneration';
  const conn = await chooseProvider(ctx, project.provider, need, input.provider);
  const c = await cardContext(ctx, project, card, input.overrides, input.baseRev);
  const tc: TaskContext = { project, page: c.page, design: c.design, rejections: c.rejections, request: input.text, layerId: input.layerId, previewUrl: input.previewUrl };
  const { task, post } = textTask(intent, tc);
  return enqueue(ctx, {
    type: task.kind === 'vision' ? 'ai.vision' : intent === 'UNKNOWN' ? 'ai.classify' : 'ai.text', executor: 'companion', projectId, cardId: card.id, provider: conn.provider,
    input: { task, post, provider: conn.provider, meta: { cardId: card.id, projectId, layerId: input.layerId ?? null, request: input.text } },
  });
}

export interface GenerateInput {
  cardIds: string[];
  prompt: string;
  variations: number;
  mode: 'generate' | 'edit';
  provider?: string | null;
  autoUse: boolean;
  /** Always group the jobs in a batch, even one, so the review screen can follow the run. */
  review?: boolean;
  /** Add the jobs to this batch instead of starting a new one (a card generated again from review). */
  batchId?: string | null;
  /** asset id → signed URL, for edit mode and references (signed by the caller, which owns storage). */
  urls: Record<string, string>;
}

async function generationContext(ctx: Ctx, project: Project, card: Card, request: string) {
  const c = await cardContext(ctx, project, card);
  const refs = await ctx.db.query<Reference>(P.references(project.id), { limit: 40 });
  const recipe = await getRecipe(ctx, project.recipeId);
  return {
    c,
    gc: {
      project, recipeName: recipe?.name, page: c.page, design: c.design, rejections: c.rejections, originalPrompt: c.lastPrompt,
      references: refs.map((r) => ({ kind: r.kind, note: r.note || r.assetId })), request,
      width: c.design.canvas.width, height: c.design.canvas.height,
    },
  };
}

export async function composePreview(ctx: Ctx, projectId: string, cardId: string, prompt: string, mode: 'generate' | 'edit') {
  const project = await getProject(ctx, projectId);
  const card = await getCard(ctx, projectId, cardId);
  const { gc } = await generationContext(ctx, project, card, prompt);
  return imageTask({ ...gc, mode, n: 1 }).prompt;
}

/** Background generation, one job per card (PRD §33–34, §64): failures never take successes with them. */
export async function createGenerateJobs(ctx: Ctx, projectId: string, input: GenerateInput) {
  const project = await getProject(ctx, projectId);
  const conn = await chooseProvider(ctx, project.provider, input.mode === 'edit' ? 'imageEditing' : 'imageGeneration', input.provider);
  const jobs = [];
  for (const cardId of input.cardIds) {
    const card = await getCard(ctx, projectId, cardId);
    const { c, gc } = await generationContext(ctx, project, card, input.prompt);
    const bg = c.design.layers.find((l) => l.type === 'background');
    const editUrl = input.mode === 'edit' && bg?.type === 'background' && bg.assetId ? input.urls[bg.assetId] ?? null : null;
    if (input.mode === 'edit' && !editUrl) throw invalid(`${card.name} has no background to edit.`);
    const { task, post, prompt } = imageTask({ ...gc, mode: input.mode, editImageUrl: editUrl, n: Math.min(4, Math.max(1, input.variations)) });
    jobs.push({ type: 'ai.image' as const, executor: 'companion' as const, cardId, provider: conn.provider,
      input: { task, post, provider: conn.provider, meta: { cardId, projectId, autoUse: input.autoUse, request: input.prompt, composedPrompt: prompt, assetIds: [] } } });
  }
  if (input.batchId) return { batchId: input.batchId, jobs: await appendToBatch(ctx, input.batchId, jobs) };
  if (jobs.length === 1 && !input.review) return { batchId: null, jobs: [await enqueue(ctx, { ...jobs[0], projectId })] };
  const { batch, jobs: docs } = await enqueueBatch(ctx, projectId, 'generate', `Generating ${jobs.length} backgrounds`, jobs);
  await audit(ctx, 'batch.started', 'project', projectId, { action: 'generate', cards: jobs.length, provider: conn.provider });
  return { batchId: batch.id, jobs: docs };
}

/** A generated image arrived from the companion: it becomes a project asset, and the job lists it. */
export async function recordGeneratedAsset(ctx: Ctx, job: Job, asset: Asset) {
  await ctx.db.set(P.asset(asset.id), asset);
  await ctx.db.transaction(async (tx) => {
    const j = await tx.get<Job>(P.job(job.id));
    const meta = ((j?.input as { meta?: { assetIds?: string[] } })?.meta ?? {}) as { assetIds?: string[] };
    tx.update(P.job(job.id), { input: { ...(j!.input as object), meta: { ...meta, assetIds: [...(meta.assetIds ?? []), asset.id] } }, updatedAt: nowIso() });
  });
}

export interface CompanionResult {
  ok: boolean;
  json?: unknown;
  text?: string;
  error?: { code: string; message: string; resetAt?: string | null };
  imageUnavailable?: boolean;
}

/** The companion finished (or couldn't). Post-process into what the dashboard shows (PRD §34, §60). */
export async function finishCompanionJob(ctx: Ctx, jobId: string, r: CompanionResult) {
  const job = await ctx.db.get<Job>(P.job(jobId));
  if (!job) throw notFound('job');
  if (job.status !== 'running') return job;
  const input = job.input as { post: PostKind; provider: ProviderId; meta: Record<string, unknown>; task: AiTask };
  const meta = input.meta ?? {};
  if (!r.ok) {
    if (r.error?.code === 'usage_limit') {
      await pauseJob(ctx.db, job, r.error.message || 'Provider usage limit', r.error.resetAt ?? null);
      const cur = (await getConnections(ctx)).find((c) => c.id === input.provider)!;
      await ctx.db.set(P.connection(input.provider), { ...cur, status: 'limited', usageLimit: { reached: true, resetAt: r.error.resetAt ?? null, message: r.error.message }, updatedAt: nowIso() });
      return { ...job, status: 'paused' as const };
    }
    if (r.imageUnavailable) {
      const cur = (await getConnections(ctx)).find((c) => c.id === input.provider)!;
      await ctx.db.set(P.connection(input.provider), { ...cur, capabilities: { ...cur.capabilities, imageGeneration: false, imageEditing: false }, updatedAt: nowIso() });
    }
    await failJob(ctx.db, job, new Error(r.error?.message ?? 'AI task failed'), r.imageUnavailable ? 'Image generation is unavailable on this connection.' : friendlyAi(r.error?.message));
    return { ...job, status: 'failed' as const };
  }
  const json = compact(r.json) as Record<string, any>;
  let output: Record<string, unknown>;
  switch (input.post) {
    case 'route': output = { kind: 'route', result: { ...json, source: 'ai', targets: json?.targets ?? [], confidence: json?.confidence ?? 0.7, explanation: json?.explanation ?? '' } }; break;
    case 'copy': output = { kind: 'copy', layerId: meta.layerId ?? 'headline', text: json?.text, alternatives: json?.alternatives ?? [], rationale: json?.rationale }; break;
    case 'gradient': { const { explanation, ...patch } = json ?? {}; output = { kind: 'gradient', patch, explanation }; break; }
    case 'critique': output = { kind: 'critique', summary: json?.summary ?? '', issues: json?.issues ?? [], suggestedRules: json?.suggestedRules ?? [] }; break;
    case 'consistency': {
      const cardIds = (meta.cardIds as string[]) ?? [];
      const ids = (nums: number[] = []) => nums.map((n) => cardIds[n - 1]).filter(Boolean);
      const t = nowIso();
      const sug: Suggestion[] = [
        ...(json?.issues ?? []).map((i: { text: string; severity: string; cards: number[] }) => ({ id: newId('sug'), projectId: String(meta.projectId), kind: 'consistency' as const, text: `${i.severity === 'high' ? '⚑ ' : ''}${i.text}`, cardIds: ids(i.cards), status: 'pending' as const, provider: input.provider, createdAt: t })),
        ...(json?.duplicateSubjects ?? []).map((d: { cards: number[]; note: string }) => ({ id: newId('sug'), projectId: String(meta.projectId), kind: 'duplicate_subject' as const, text: d.note, cardIds: ids(d.cards), status: 'pending' as const, provider: input.provider, createdAt: t })),
        ...(json?.suggestedRules ?? []).map((r: string) => ({ id: newId('sug'), projectId: String(meta.projectId), kind: 'rule' as const, text: r, cardIds: [], status: 'pending' as const, provider: input.provider, createdAt: t })),
      ];
      for (const x of sug) await ctx.db.set(P.suggestion(x.projectId, x.id), x);
      output = { kind: 'consistency', summary: json?.summary ?? '', suggestions: sug.length };
      break;
    }
    case 'analysis': {
      output = { kind: 'analysis', ...json };
      const assetId = meta.assetId as string | undefined;
      if (assetId) {
        const a = await ctx.db.get<Asset>(P.asset(assetId));
        if (a) await ctx.db.update(P.asset(assetId), { analysis: { description: json?.description, visibleText: json?.visibleText, tags: json?.tags, provider: input.provider },
          flags: { ...a.flags, containsText: !!json?.containsText, containsLogo: !!json?.containsLogo } });
      }
      break;
    }
    case 'images': {
      const fresh = (await ctx.db.get<Job>(P.job(jobId)))!;
      const assetIds = ((fresh.input as { meta: { assetIds?: string[] } }).meta.assetIds ?? []);
      if (!assetIds.length) {
        await failJob(ctx.db, job, new Error('no images returned'), 'The provider returned no image. Try again or adjust the prompt.');
        return { ...job, status: 'failed' as const };
      }
      output = { kind: 'images', assetIds };
      if (meta.autoUse && meta.cardId) {
        await useGenerated(ctx, String(meta.projectId), String(meta.cardId), assetIds[0], { prompt: String(meta.request ?? ''), provider: input.provider, jobId });
      }
      break;
    }
    default: output = { kind: 'text', text: r.text };
  }
  await completeJob(ctx.db, job, output);
  return { ...job, status: 'completed' as const, output };
}

function friendlyAi(msg?: string) {
  if (!msg) return 'The AI could not complete this.';
  if (/not (logged|signed) in|login/i.test(msg)) return 'The provider is not signed in on the companion. Open AI Connections.';
  if (/timed? ?out|timeout/i.test(msg)) return 'The AI took too long. Try again.';
  if (/json|parse|schema/i.test(msg)) return 'The AI reply was not usable. Try again.';
  return 'The AI could not complete this.';
}

/** "Use" a generated background (PRD §34): a new version, nothing overwritten. */
export async function useGenerated(ctx: Ctx, projectId: string, cardId: string, assetId: string, opts: { prompt?: string; provider?: string | null; jobId?: string | null }) {
  const card = await getCard(ctx, projectId, cardId);
  const v = card.currentVersionId ? await ctx.db.get<CardVersion>(P.version(projectId, cardId, card.currentVersionId)) : null;
  if (!v) throw invalid('This card has no version yet.');
  const rev = await revisionCached(ctx, projectId, card.draftRev ?? v.defaultsRev);
  const current = applyOverrides(rev.base, card.draft ?? v.overrides);
  const next = replaceBackground(current, assetId, 'generated');
  const { diffOverrides } = await import('@acs/renderer');
  return commitVersion(ctx, projectId, cardId, { overrides: diffOverrides(rev.base, next), defaultsRev: rev.id, reason: 'Background regenerated', prompt: opts.prompt ?? null, provider: opts.provider ?? null, jobId: opts.jobId ?? null });
}

export async function addReference(ctx: Ctx, projectId: string, assetId: string, kind: Reference['kind'], note: string) {
  const ref: Reference = { id: `ref_${assetId}`, projectId, assetId, kind, note: note.slice(0, 300), createdAt: nowIso() };
  await ctx.db.set(P.reference(projectId, ref.id), ref);
  if (kind === 'style' || kind === 'direction') await ctx.db.update(P.asset(assetId), { type: 'reference' });
  return ref;
}

/** Review a whole project's look with vision (PRD §89). Up to 12 cards per review. */
export async function createConsistencyJob(ctx: Ctx, projectId: string, cards: { id: string; name: string; url: string }[]) {
  const project = await getProject(ctx, projectId);
  if (cards.length < 2) throw invalid('Render at least two cards before reviewing the set.');
  const conn = await chooseProvider(ctx, project.provider, 'visionAnalysis');
  const pick = cards.slice(0, 12);
  const { task, post } = consistencyTask({ project, cards: pick.map((c, i) => ({ n: i + 1, name: c.name, url: c.url })) });
  return enqueue(ctx, { type: 'ai.vision', executor: 'companion', projectId, provider: conn.provider,
    input: { task, post, provider: conn.provider, meta: { projectId, cardIds: pick.map((c) => c.id) } } });
}

export async function listSuggestions(ctx: Ctx, projectId: string) {
  return (await ctx.db.query<Suggestion>(P.suggestions(projectId), { orderBy: [['createdAt', 'desc']], limit: 100 })).filter((s) => s.status === 'pending');
}

/** Accepting is explicit and scoped (PRD §90): this card only, the project, or the template. */
export async function resolveSuggestion(ctx: Ctx, projectId: string, id: string, status: Suggestion['status']) {
  const s = await ctx.db.get<Suggestion>(P.suggestion(projectId, id));
  if (!s) throw notFound('suggestion');
  if (status === 'accepted_project') {
    const p = await getProject(ctx, projectId);
    await ctx.db.update(P.project(projectId), { rules: [...(p.rules ?? []), { id: newId('rule'), text: s.text, source: 'suggestion', createdAt: nowIso() }] });
    await audit(ctx, 'rule.accepted', 'project', projectId, { text: s.text });
  }
  if (status === 'accepted_template') {
    const p = await getProject(ctx, projectId);
    const r = await getRecipe(ctx, p.recipeId);
    if (r) await ctx.db.set(P.recipe(r.id), { ...r, brief: `${r.brief ?? ''}\n${s.text}`.trim(), updatedAt: nowIso() });
    await audit(ctx, 'rule.accepted', 'recipe', p.recipeId, { text: s.text });
  }
  await ctx.db.update(P.suggestion(projectId, id), { status });
  return { ...s, status };
}
