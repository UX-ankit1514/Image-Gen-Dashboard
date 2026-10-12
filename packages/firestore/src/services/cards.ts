/**
 * Cards and their versions (PRD §17, §40–44). A card stores a sparse override on its project's
 * base; every meaningful change becomes an immutable version; the approved version is a pointer
 * that editing never moves (PRD §68, Rule 9).
 */
import { applyOverrides, cleanKicker, diffOverrides, REPEAT_FOCUS, updateLayer } from '@acs/renderer';
import { invalid, newId, notFound, nowIso, slugify } from '@acs/shared';
import {
  COPY_TAGS, IMAGE_TAGS,
  type Asset, type BackgroundLayer, type Card, type CardStatus, type CardVersion, type CardWarning, type DefaultsRevision,
  type Design, type Feedback, type Overrides, type Project, type Reference, type RejectTag, type SourcePage, type TextLayer,
} from '@acs/types';
import type { WriteOp } from '../db';
import { P } from '../paths';
import { audit } from './audit';
import type { Ctx } from './context';
import { jobOp, makeJob } from './jobs';
import { getProject, getRevision, recomputeStats } from './projects';

/** Warnings that come from the source material rather than the render. */
export const SOURCE_CODES = new Set(['missing_image', 'low_res', 'possible_text', 'text_in_photo', 'duplicate', 'no_highlights', 'aspect_mismatch', 'source_changed', 'source_removed', 'unmatched_upload']);

export function assetWarnings(asset: Asset | null): CardWarning[] {
  if (!asset) return [{ code: 'missing_image', severity: 'error', message: 'No suitable image on the page yet.' }];
  const w: CardWarning[] = [];
  if (asset.flags.lowRes) w.push({ code: 'low_res', severity: 'warning', message: `Source image is ${asset.width}×${asset.height}; it will be upscaled.` });
  if (asset.flags.containsText) w.push({ code: 'text_in_photo', severity: 'warning', message: 'Text detected inside the background.' });
  else if (asset.flags.possibleText) w.push({ code: 'possible_text', severity: 'info', message: 'Potential text detected inside background.' });
  if (asset.flags.aspectMismatch) w.push({ code: 'aspect_mismatch', severity: 'info', message: 'The image aspect ratio is far from the card; cover will crop a lot.' });
  return w;
}

/** card.kicker(): the first Highlights & Benefits entry, else the authority, else the country. */
export function keyLineOf(page: SourcePage): { text: string; provenance: TextLayer['provenance'] } {
  const h = page.highlights?.[0]?.title;
  if (h) return { text: cleanKicker(h), provenance: { kind: 'page-highlight', original: cleanKicker(h), ref: 'highlight:0' } };
  if (page.subheading) return { text: cleanKicker(page.subheading), provenance: { kind: 'page-highlight', original: page.subheading, ref: 'subheading' } };
  const fallback = page.authority || page.country || '';
  return { text: cleanKicker(fallback), provenance: { kind: 'page-title', original: fallback, ref: page.authority ? 'authority' : 'country' } };
}

const ROLE_ORDER = ['banner', 'slider', 'hero', 'og', 'content', 'alternative', 'cached'];

export function pickBackground(page: SourcePage) {
  const ready = page.images.filter((i) => i.assetId);
  ready.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  return ready[0]?.assetId ?? null;
}

function cardDoc(project: Project, init: Partial<Card> & { name: string }): Card {
  const t = nowIso();
  return {
    id: newId('card'), projectId: project.id, sourcePageId: null, slug: slugify(init.name), order: 0, status: 'draft', stage: 'imported',
    currentVersionId: null, approvedVersionId: null, versionCount: 0, draft: null, draftRev: null, draftUpdatedAt: null, dirty: false,
    backgroundAssetId: null, thumbKey: null, previewKey: null, warnings: [], sourceLabel: 'Website', createdAt: t, updatedAt: t, ...init,
  };
}

function versionDoc(card: Card, n: number, overrides: Overrides, rev: string, d: Design, reason: string, ctx: Ctx, extra: Partial<CardVersion> = {}): CardVersion {
  return {
    id: newId('ver'), cardId: card.id, projectId: card.projectId, number: n, width: d.canvas.width, height: d.canvas.height,
    overrides, defaultsRev: rev, previewKey: null, thumbKey: null, reason, actor: ctx.actor, provider: null, prompt: null,
    jobId: null, parentVersionId: card.currentVersionId, createdAt: nowIso(), ...extra,
  };
}

function renderJob(ctx: Ctx, card: Card, version: CardVersion, extra: Record<string, unknown> = {}) {
  return makeJob(ctx, { type: 'render', projectId: card.projectId, cardId: card.id, input: { projectId: card.projectId, cardId: card.id, versionId: version.id, purpose: 'preview', ...extra } });
}

function bgOf(d: Design) {
  return d.layers.find((l) => l.type === 'background') as BackgroundLayer | undefined;
}

/** "Create cards" from scanned pages (PRD §14). Nothing is generated before the user asks. */
export async function createCardsFromPages(ctx: Ctx, projectId: string, pageIds: string[], backgrounds: Record<string, string> = {}) {
  const project = await getProject(ctx, projectId);
  const rev = await getRevision(ctx, projectId, project.defaultsRev);
  const pages = (await ctx.db.getMany<SourcePage>(pageIds.map((id) => P.page(projectId, id)))).filter(Boolean) as SourcePage[];
  const existing = await ctx.db.query<Card>(P.cards(projectId));
  let order = existing.reduce((m, c) => Math.max(m, c.order), 0);
  const usage = new Map<string, number>();
  for (const c of existing) if (c.backgroundAssetId) usage.set(c.backgroundAssetId, (usage.get(c.backgroundAssetId) ?? 0) + 1);
  const assetIds = [...new Set(pages.map((p) => backgrounds[p.id] ?? pickBackground(p)).filter(Boolean))] as string[];
  const assets = new Map((await ctx.db.getMany<Asset>(assetIds.map((a) => P.asset(a)))).filter(Boolean).map((a) => [a!.id, a!]));

  const ops: WriteOp[] = [];
  const created: Card[] = [];
  for (const page of pages) {
    const assetId = backgrounds[page.id] ?? pickBackground(page);
    const asset = assetId ? assets.get(assetId) ?? null : null;
    let d = rev.base;
    const bg = bgOf(d);
    if (bg && assetId) {
      // repeats of one photo get the legacy alternate framings so the set isn't copy-pasted
      const n = usage.get(assetId) ?? 0;
      usage.set(assetId, n + 1);
      const [fx, fy] = REPEAT_FOCUS[n % REPEAT_FOCUS.length];
      d = updateLayer(d, bg.id, { assetId, source: 'website', focalX: fx, focalY: fy } as Partial<BackgroundLayer>);
    }
    const title = page.h1 || page.name || page.title;
    d = updateLayer(d, 'headline', { text: title, provenance: { kind: 'website-h1', original: page.h1 || null, ref: 'h1' } } as Partial<TextLayer>);
    const key = keyLineOf(page);
    d = updateLayer(d, 'subheading', { text: key.text, provenance: key.provenance } as Partial<TextLayer>);

    const warnings: CardWarning[] = assetWarnings(asset);
    if (!page.highlights?.length) warnings.push({ code: 'no_highlights', severity: 'info', message: 'The page has no Highlights & Benefits; the key line uses the authority or country.' });
    const card = cardDoc(project, {
      name: page.name || title, sourcePageId: page.id, order: ++order, status: assetId ? 'draft' : 'needs_image',
      stage: assetId ? 'image_ready' : 'source_verified', backgroundAssetId: assetId, warnings, sourceLabel: 'Website',
    });
    const overrides = diffOverrides(rev.base, d);
    const v = versionDoc(card, 1, overrides, rev.id, d, assetId ? 'Initial website image' : 'Imported — needs image', ctx);
    card.currentVersionId = v.id;
    card.versionCount = 1;
    ops.push({ kind: 'create', path: P.card(projectId, card.id), data: card });
    ops.push({ kind: 'create', path: P.version(projectId, card.id, v.id), data: v });
    if (assetId) ops.push(jobOp(renderJob(ctx, card, v, { initial: true })));
    created.push(card);
  }
  for (let i = 0; i < ops.length; i += 450) await ctx.db.commit(ops.slice(i, i + 450));
  await ctx.db.update(P.project(projectId), { lastEditedAt: nowIso() });
  await recomputeStats(ctx, projectId);
  await audit(ctx, 'cards.created', 'project', projectId, { count: created.length });
  return created;
}

/** A card without a source page: upload, screenshot or blank (PRD §12, §16). */
export async function createBlankCard(ctx: Ctx, projectId: string, init: { name: string; backgroundAssetId?: string | null; headline?: string; subheading?: string; sourceLabel?: string; sourcePageId?: string | null }) {
  const project = await getProject(ctx, projectId);
  const rev = await getRevision(ctx, projectId, project.defaultsRev);
  const existing = await ctx.db.query<Card>(P.cards(projectId));
  const asset = init.backgroundAssetId ? await ctx.db.get<Asset>(P.asset(init.backgroundAssetId)) : null;
  let d = rev.base;
  const bg = bgOf(d);
  if (bg && asset) d = updateLayer(d, bg.id, { assetId: asset.id, source: asset.source === 'generated' ? 'generated' : asset.source === 'website' ? 'website' : 'uploaded' } as Partial<BackgroundLayer>);
  if (init.headline !== undefined) d = updateLayer(d, 'headline', { text: init.headline, provenance: { kind: 'manual', original: null } } as Partial<TextLayer>);
  if (init.subheading !== undefined) d = updateLayer(d, 'subheading', { text: init.subheading, provenance: { kind: 'manual', original: null } } as Partial<TextLayer>);
  const card = cardDoc(project, {
    name: init.name, order: existing.reduce((m, c) => Math.max(m, c.order), 0) + 1, sourcePageId: init.sourcePageId ?? null,
    status: asset ? 'draft' : 'needs_image', stage: asset ? 'image_ready' : 'imported', backgroundAssetId: asset?.id ?? null,
    warnings: asset ? assetWarnings(asset) : [], sourceLabel: init.sourceLabel ?? (asset ? 'Upload' : 'Blank'),
  });
  const v = versionDoc(card, 1, diffOverrides(rev.base, d), rev.id, d, asset ? 'Initial uploaded image' : 'Blank canvas', ctx);
  card.currentVersionId = v.id;
  card.versionCount = 1;
  await ctx.db.commit([
    { kind: 'create', path: P.card(projectId, card.id), data: card },
    { kind: 'create', path: P.version(projectId, card.id, v.id), data: v },
    jobOp(renderJob(ctx, card, v)),
  ]);
  await recomputeStats(ctx, projectId);
  return card;
}

/** Copy of a card into another project (duplicate project): its current look becomes V1. */
export async function cardCopyOps(ctx: Ctx, srcProject: Project, c: Card, dst: Project, revId: string, reason: string): Promise<WriteOp[]> {
  const v = c.currentVersionId ? await ctx.db.get<CardVersion>(P.version(srcProject.id, c.id, c.currentVersionId)) : null;
  const card: Card = { ...c, id: newId('card'), projectId: dst.id, approvedVersionId: null, versionCount: 1, draft: null, draftRev: null, dirty: false,
    status: c.status === 'archived' ? 'archived' : 'draft', createdAt: nowIso(), updatedAt: nowIso() };
  const nv: CardVersion = { ...(v ?? ({} as CardVersion)), id: newId('ver'), cardId: card.id, projectId: dst.id, number: 1, reason, parentVersionId: null,
    overrides: c.draft ?? v?.overrides ?? {}, defaultsRev: revId, createdAt: nowIso(), actor: ctx.actor };
  card.currentVersionId = nv.id;
  return [
    { kind: 'create', path: P.card(dst.id, card.id), data: card },
    { kind: 'create', path: P.version(dst.id, card.id, nv.id), data: nv },
    jobOp(renderJob(ctx, card, nv)),
  ];
}

export async function getCard(ctx: Ctx, projectId: string, cardId: string) {
  const c = await ctx.db.get<Card>(P.card(projectId, cardId));
  if (!c) throw notFound('card');
  return c;
}

export async function getVersion(ctx: Ctx, projectId: string, cardId: string, versionId: string) {
  const v = await ctx.db.get<CardVersion>(P.version(projectId, cardId, versionId));
  if (!v) throw notFound('version');
  return v;
}

export async function listVersions(ctx: Ctx, projectId: string, cardId: string) {
  return ctx.db.query<CardVersion>(P.versions(projectId, cardId), { orderBy: [['number', 'desc']] });
}

const revCache = new Map<string, DefaultsRevision>();
export async function revisionCached(ctx: Ctx, projectId: string, revId: string) {
  const k = `${projectId}/${revId}`;
  let r = revCache.get(k);
  if (!r) {
    r = await getRevision(ctx, projectId, revId);
    if (revCache.size > 200) revCache.clear();
    revCache.set(k, r);
  }
  return r;
}

export async function designOfVersion(ctx: Ctx, v: CardVersion) {
  const rev = await revisionCached(ctx, v.projectId, v.defaultsRev);
  return applyOverrides(rev.base, v.overrides);
}

/** Everything the editor needs to open a card, with no rescraping (PRD §56). */
export async function getCardBundle(ctx: Ctx, projectId: string, cardId: string) {
  const card = await getCard(ctx, projectId, cardId);
  const version = card.currentVersionId ? await getVersion(ctx, projectId, cardId, card.currentVersionId) : null;
  const project = await getProject(ctx, projectId);
  const revId = card.draftRev ?? version?.defaultsRev ?? project.defaultsRev;
  const rev = await revisionCached(ctx, projectId, revId);
  const overrides = card.draft ?? version?.overrides ?? {};
  const design = applyOverrides(rev.base, overrides);
  const [page, versions, feedback] = await Promise.all([
    card.sourcePageId ? ctx.db.get<SourcePage>(P.page(projectId, card.sourcePageId)) : Promise.resolve(null),
    listVersions(ctx, projectId, cardId),
    ctx.db.query<Feedback>(P.feedback(projectId, cardId), { orderBy: [['createdAt', 'desc']], limit: 50 }),
  ]);
  return { project, card, version, base: rev.base, baseRev: rev.id, design, page, versions, feedback };
}

export async function saveDraft(ctx: Ctx, projectId: string, cardId: string, draft: Overrides, baseRev: string) {
  const t = nowIso();
  await ctx.db.update(P.card(projectId, cardId), { draft, draftRev: baseRev, draftUpdatedAt: t, dirty: true, updatedAt: t });
  await ctx.db.update(P.project(projectId), { lastEditedAt: t });
  return { savedAt: t };
}

const LAYER_NAMES: Record<string, string> = { background: 'Background', gradient: 'Gradient', logo: 'Logo', headline: 'Heading', subheading: 'Subheading' };

/** "V2 Gradient changed", "V4 Manual crop", "V5 Heading edited" (PRD §44). */
export function describeChange(before: Design | null, after: Design): string {
  if (!before) return 'Initial version';
  const parts: string[] = [];
  if (before.canvas.width !== after.canvas.width || before.canvas.height !== after.canvas.height) parts.push(`Resized to ${after.canvas.width} × ${after.canvas.height}`);
  const byId = new Map(before.layers.map((l) => [l.id, l]));
  for (const l of after.layers) {
    const b = byId.get(l.id);
    const name = LAYER_NAMES[l.id] ?? l.name;
    if (!b) { parts.push(`${name} added`); continue; }
    if (JSON.stringify(b) === JSON.stringify(l)) continue;
    if (b.visible !== l.visible) { parts.push(`${name} ${l.visible ? 'shown' : 'hidden'}`); continue; }
    if (l.type === 'background' && b.type === 'background') {
      if (b.assetId !== l.assetId) parts.push(l.source === 'generated' ? 'Background regenerated' : 'Background replaced');
      else if (b.zoom !== l.zoom || b.offsetX !== l.offsetX || b.offsetY !== l.offsetY) parts.push('Manual crop');
      else if (b.focalX !== l.focalX || b.focalY !== l.focalY) parts.push('Background repositioned');
      else if (b.flipX !== l.flipX || b.flipY !== l.flipY) parts.push('Background flipped');
      else parts.push('Background adjusted');
    } else if (l.type === 'gradient') parts.push('Gradient changed');
    else if (l.type === 'text' && b.type === 'text') {
      if (b.text !== l.text) parts.push(`${name} edited`);
      else if (b.x !== l.x || b.y !== l.y) parts.push(`${name} moved`);
      else parts.push(`${name} restyled`);
    } else if (b.x !== l.x || b.y !== l.y) parts.push(`${name} moved`);
    else if (b.width !== l.width || b.height !== l.height) parts.push(`${name} resized`);
    else parts.push(`${name} changed`);
  }
  for (const b of before.layers) if (!after.layers.some((l) => l.id === b.id)) parts.push(`${LAYER_NAMES[b.id] ?? b.name} removed`);
  if (!parts.length) return 'No visual change';
  const uniq = [...new Set(parts)];
  return uniq.length > 3 ? `${uniq.slice(0, 3).join(', ')} +${uniq.length - 3} more` : uniq.join(', ');
}

export interface CommitOptions {
  reason?: string;
  prompt?: string | null;
  provider?: string | null;
  overrides?: Overrides;
  defaultsRev?: string;
  force?: boolean;
  jobId?: string | null;
  /** Approved cards are left alone by bulk operations unless this is set (PRD §57, Rule 9). */
  status?: CardStatus;
}

/** Turn the draft (or given overrides) into the next immutable version and queue its render. */
export async function commitVersion(ctx: Ctx, projectId: string, cardId: string, opts: CommitOptions = {}) {
  const card = await getCard(ctx, projectId, cardId);
  const prev = card.currentVersionId ? await getVersion(ctx, projectId, cardId, card.currentVersionId) : null;
  const overrides = opts.overrides ?? card.draft ?? prev?.overrides ?? {};
  const revId = opts.defaultsRev ?? (opts.overrides ? prev?.defaultsRev : card.draftRev) ?? prev?.defaultsRev;
  if (!revId) throw invalid('This card has no base design.');
  if (!opts.force && prev && JSON.stringify(prev.overrides) === JSON.stringify(overrides) && prev.defaultsRev === revId) {
    if (card.dirty) await ctx.db.update(P.card(projectId, cardId), { draft: null, draftRev: null, dirty: false });
    return { card: { ...card, dirty: false, draft: null }, version: prev, created: false };
  }
  const rev = await revisionCached(ctx, projectId, revId);
  const after = applyOverrides(rev.base, overrides);
  const before = prev ? await designOfVersion(ctx, prev) : null;
  const reason = opts.reason ?? describeChange(before, after);
  const v = versionDoc(card, card.versionCount + 1, overrides, revId, after, reason, ctx, { prompt: opts.prompt ?? null, provider: opts.provider ?? null, jobId: opts.jobId ?? null });
  const bgId = bgOf(after)?.visible ? bgOf(after)?.assetId ?? null : null;
  const patch: Partial<Card> = {
    currentVersionId: v.id, versionCount: v.number, draft: null, draftRev: null, dirty: false, updatedAt: v.createdAt,
    stage: bgId ? 'image_ready' : card.stage, backgroundAssetId: bgId,
  };
  // editing a reviewed card sends it back for review; the approved pointer stays put
  patch.status = opts.status ?? (['approved', 'exported', 'rejected', 'needs_image', 'needs_copy'].includes(card.status) ? 'needs_review' : card.status);
  if (patch.status === 'needs_review' && !bgId && card.status === 'needs_image') patch.status = 'needs_image';
  if (bgId !== card.backgroundAssetId) {
    const asset = bgId ? await ctx.db.get<Asset>(P.asset(bgId)) : null;
    patch.warnings = [...card.warnings.filter((w) => !SOURCE_CODES.has(w.code) || w.code === 'no_highlights' || w.code.startsWith('source_')), ...(bgId || bgOf(after)?.visible ? assetWarnings(asset) : [])];
  }
  const job = renderJob(ctx, { ...card, ...patch } as Card, v);
  await ctx.db.commit([
    { kind: 'create', path: P.version(projectId, cardId, v.id), data: v },
    { kind: 'update', path: P.card(projectId, cardId), data: patch },
    jobOp(job),
  ]);
  await ctx.db.update(P.project(projectId), { lastEditedAt: v.createdAt });
  if (patch.status !== card.status) await recomputeStats(ctx, projectId);
  return { card: { ...card, ...patch } as Card, version: v, created: true, renderJobId: job.id };
}

export async function approveCard(ctx: Ctx, projectId: string, cardId: string) {
  let card = await getCard(ctx, projectId, cardId);
  if (card.dirty) card = (await commitVersion(ctx, projectId, cardId)).card;
  if (!card.currentVersionId) throw invalid('There is nothing to approve yet.');
  const v = await getVersion(ctx, projectId, cardId, card.currentVersionId);
  const t = nowIso();
  const fb: Feedback = { id: newId('fb'), cardId, projectId, versionId: v.id, kind: 'approve', tags: [], text: '', backgroundAssetId: card.backgroundAssetId, actor: ctx.actor, createdAt: t };
  const ops: WriteOp[] = [
    { kind: 'update', path: P.card(projectId, cardId), data: { approvedVersionId: v.id, status: 'approved', stage: 'approved', updatedAt: t } },
    { kind: 'create', path: P.feedbackDoc(projectId, cardId, fb.id), data: fb },
  ];
  if (card.backgroundAssetId) {
    const ref: Reference = { id: `ref_${card.backgroundAssetId}`, projectId, assetId: card.backgroundAssetId, kind: 'approved', note: card.name, createdAt: t };
    ops.push({ kind: 'set', path: P.reference(projectId, ref.id), data: ref });
  }
  await ctx.db.commit(ops);
  await recomputeStats(ctx, projectId);
  await audit(ctx, 'card.approved', 'card', cardId, { projectId, version: v.number });
  return { ...card, approvedVersionId: v.id, status: 'approved' as const };
}

/** Structured rejection (PRD §42). The feedback is what regeneration will read later (§43). */
export async function rejectCard(ctx: Ctx, projectId: string, cardId: string, tags: RejectTag[], text = '') {
  let card = await getCard(ctx, projectId, cardId);
  if (card.dirty) card = (await commitVersion(ctx, projectId, cardId)).card;
  const t = nowIso();
  const status: CardStatus = tags.some((x) => IMAGE_TAGS.includes(x)) ? 'needs_image' : tags.some((x) => COPY_TAGS.includes(x)) ? 'needs_copy' : 'rejected';
  const fb: Feedback = { id: newId('fb'), cardId, projectId, versionId: card.currentVersionId, kind: 'reject', tags, text, backgroundAssetId: card.backgroundAssetId, actor: ctx.actor, createdAt: t };
  const patch: Partial<Card> = { status, updatedAt: t, warnings: [...card.warnings.filter((w) => w.code !== 'rejected_image'),
    ...(tags.some((x) => IMAGE_TAGS.includes(x)) ? [{ code: 'rejected_image' as const, severity: 'warning' as const, message: `Rejected: ${tags.join(', ')}`, detail: text }] : [])] };
  // a rejected version can never be the production export
  if (card.approvedVersionId && card.approvedVersionId === card.currentVersionId) patch.approvedVersionId = null;
  const ops: WriteOp[] = [
    { kind: 'update', path: P.card(projectId, cardId), data: patch },
    { kind: 'create', path: P.feedbackDoc(projectId, cardId, fb.id), data: fb },
  ];
  if (card.backgroundAssetId && tags.some((x) => IMAGE_TAGS.includes(x))) {
    const ref: Reference = { id: `ref_${card.backgroundAssetId}`, projectId, assetId: card.backgroundAssetId, kind: 'rejected', note: [tags.join(', '), text].filter(Boolean).join(' — '), createdAt: t };
    ops.push({ kind: 'set', path: P.reference(projectId, ref.id), data: ref });
  }
  await ctx.db.commit(ops);
  await recomputeStats(ctx, projectId);
  await audit(ctx, 'card.rejected', 'card', cardId, { projectId, tags, text });
  return { ...card, ...patch } as Card;
}

export async function restoreVersion(ctx: Ctx, projectId: string, cardId: string, versionId: string) {
  const v = await getVersion(ctx, projectId, cardId, versionId);
  const r = await commitVersion(ctx, projectId, cardId, { overrides: v.overrides, defaultsRev: v.defaultsRev, reason: `Restored V${v.number}`, force: true });
  await audit(ctx, 'card.restored', 'card', cardId, { projectId, from: v.number });
  return r;
}

export async function duplicateCard(ctx: Ctx, projectId: string, cardId: string, versionId?: string) {
  const src = await getCard(ctx, projectId, cardId);
  const v = await getVersion(ctx, projectId, cardId, versionId ?? src.currentVersionId!);
  const all = await ctx.db.query<Card>(P.cards(projectId));
  const card: Card = { ...src, id: newId('card'), name: `${src.name} (copy)`, order: all.reduce((m, c) => Math.max(m, c.order), 0) + 1,
    approvedVersionId: null, versionCount: 1, draft: null, draftRev: null, dirty: false, status: 'draft', createdAt: nowIso(), updatedAt: nowIso() };
  const nv: CardVersion = { ...v, id: newId('ver'), cardId: card.id, number: 1, parentVersionId: null, reason: `Duplicated from ${src.name} V${v.number}`, createdAt: nowIso(), actor: ctx.actor };
  card.currentVersionId = nv.id;
  await ctx.db.commit([
    { kind: 'create', path: P.card(projectId, card.id), data: card },
    { kind: 'create', path: P.version(projectId, card.id, nv.id), data: nv },
    jobOp(renderJob(ctx, card, nv)),
  ]);
  await recomputeStats(ctx, projectId);
  return card;
}

export async function setCardStatus(ctx: Ctx, projectId: string, cardId: string, status: CardStatus) {
  await ctx.db.update(P.card(projectId, cardId), { status, updatedAt: nowIso() });
  await recomputeStats(ctx, projectId);
}

export async function renameCard(ctx: Ctx, projectId: string, cardId: string, name: string) {
  await ctx.db.update(P.card(projectId, cardId), { name, slug: slugify(name), updatedAt: nowIso() });
}

export async function listCards(ctx: Ctx, projectId: string) {
  return ctx.db.query<Card>(P.cards(projectId), { orderBy: [['order', 'asc']] });
}
