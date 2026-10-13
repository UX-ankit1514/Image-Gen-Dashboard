/** Scans, source pages, assets, exports and the exception inbox. */
import { invalid, newId, notFound, nowIso } from '@acs/shared';
import {
  INBOX_CATEGORIES,
  type Asset, type Card, type ExportBody, type ExportRecord, type Job, type Project, type Scan, type SourceChange, type SourcePage,
} from '@acs/types';
import { P } from '../paths';
import { audit } from './audit';
import type { Ctx } from './context';
import { jobOp, makeJob } from './jobs';
import { getProject, updateProject } from './projects';

// ---------------------------------------------------------------- scans (PRD §13–14)
export function normaliseUrl(raw: string) {
  let u = (raw || '').trim().replace(/^<|>$/g, '').replace(/[,;]+$/, '');
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u.replace(/^\/+/, '')}`;
  try {
    const url = new URL(u);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    // a first SSRF screen; the fetchers re-check every hop after DNS resolution (PRD §78)
    const h = url.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^(127|10|0)\./.test(h) || /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) || h === '[::1]' || /^\[?(fc|fd|fe80)/i.test(h) || h === 'metadata.google.internal') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export async function startScan(ctx: Ctx, projectId: string, rawUrls: string[], rescanOf: string | null = null) {
  await getProject(ctx, projectId);
  const urls = [...new Set(rawUrls.map(normaliseUrl).filter(Boolean))] as string[];
  if (!urls.length) throw invalid('None of those links can be read. Use full http(s) addresses on public sites.');
  const t = nowIso();
  const scan: Scan = {
    id: newId('scan'), projectId, urls, status: 'queued', phase: 'Queued', progress: { done: 0, total: urls.length }, pages: 0, images: 0,
    warnings: [], browserRecords: null, browserFor: null, error: null, rescanOf, createdAt: t, updatedAt: t,
  };
  await ctx.db.create(P.scan(scan.id), scan);
  await audit(ctx, 'scan.started', 'project', projectId, { urls, rescan: !!rescanOf });
  return scan;
}

export async function listScans(ctx: Ctx, projectId: string) {
  return ctx.db.query<Scan>(P.scans, { where: [['projectId', '==', projectId]], orderBy: [['createdAt', 'desc']], limit: 20 });
}

export async function getScan(ctx: Ctx, id: string) {
  const s = await ctx.db.get<Scan>(P.scan(id));
  if (!s) throw notFound('scan');
  return s;
}

export async function listPages(ctx: Ctx, projectId: string, scanId?: string) {
  const pages = await ctx.db.query<SourcePage>(P.pages(projectId));
  const out = scanId ? pages.filter((p) => p.scanId === scanId) : pages;
  return out.sort((a, b) => ((a.rawMetadata?.position as number) ?? 0) - ((b.rawMetadata?.position as number) ?? 0));
}

// ---------------------------------------------------------------- assets (PRD §46)
export async function listAssets(ctx: Ctx, projectId: string | null) {
  if (projectId) return ctx.db.query<Asset>(P.assets, { where: [['projectId', '==', projectId]], orderBy: [['createdAt', 'desc']], limit: 1000 });
  return ctx.db.query<Asset>(P.assets, { where: [['projectId', '==', null]], limit: 500 });
}

export async function createAssetDoc(ctx: Ctx, a: Omit<Asset, 'id' | 'workspaceId' | 'createdAt'> & { id?: string }) {
  const asset: Asset = { ...a, id: a.id ?? newId('ast'), workspaceId: ctx.ws, createdAt: nowIso() };
  await ctx.db.set(P.asset(asset.id), asset);
  return asset;
}

export async function queueIngest(ctx: Ctx, asset: Asset, extra: Record<string, unknown> = {}) {
  const job = makeJob(ctx, { type: 'ingest', projectId: asset.projectId, input: { assetId: asset.id, mode: 'stored', ...extra } });
  await ctx.db.commit([jobOp(job)]);
  return job;
}

// ---------------------------------------------------------------- exports (PRD §67–68)
export async function createExport(ctx: Ctx, projectId: string, body: ExportBody) {
  const project = await getProject(ctx, projectId);
  const cards = (await ctx.db.query<Card>(P.cards(projectId), { orderBy: [['order', 'asc']] })).filter((c) => c.status !== 'archived');
  const chosen = body.scope === 'all' ? cards : cards.filter((c) => (body.cardIds ?? []).includes(c.id));
  if (!chosen.length) throw invalid('No cards selected.');

  // Export is what you see: every card's current version (approval no longer decides what ships).
  const files = chosen.filter((c) => c.currentVersionId).map((c) => ({ cardId: c.id, versionId: c.currentVersionId!, name: '', key: '', approved: false }));
  if (!files.length) throw invalid('This card has no saved version yet. Make a change, then try again.');

  const t = nowIso();
  const rec: ExportRecord = {
    id: newId('exp'), projectId, scope: body.scope, format: body.format, scale: body.scale, cardIds: chosen.map((c) => c.id),
    includesUnapproved: 0, status: 'queued', jobId: null, zipKey: null, files,
    options: { contactSheet: !!body.contactSheet, csv: !!body.csv, manifest: !!body.manifest, namingTemplate: body.namingTemplate || project.namingTemplate },
    error: null, createdAt: t, completedAt: null,
  };
  const job = makeJob(ctx, { type: 'export', projectId, input: { exportId: rec.id } });
  rec.jobId = job.id;
  await ctx.db.commit([{ kind: 'create', path: P.export(rec.id), data: rec }, jobOp(job)]);
  if (body.namingTemplate && body.namingTemplate !== project.namingTemplate) await updateProject(ctx, projectId, { namingTemplate: body.namingTemplate });
  await audit(ctx, 'export.created', 'project', projectId, { exportId: rec.id, files: files.length, format: body.format, scale: body.scale });
  return rec;
}

export async function listExports(ctx: Ctx, projectId?: string) {
  if (projectId) return ctx.db.query<ExportRecord>(P.exports, { where: [['projectId', '==', projectId]], orderBy: [['createdAt', 'desc']], limit: 50 });
  return ctx.db.query<ExportRecord>(P.exports, { orderBy: [['createdAt', 'desc']], limit: 100 });
}

// ---------------------------------------------------------------- exception inbox (PRD §48)
export interface InboxItem {
  category: string;
  label: string;
  projectId: string;
  projectName: string;
  cardId: string | null;
  cardName: string | null;
  message: string;
  thumbKey: string | null;
  jobId?: string;
  changeId?: string;
}

export async function buildInbox(ctx: Ctx) {
  const projects = (await ctx.db.query<Project>(P.projects)).filter((p) => p.status !== 'archived');
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const items: InboxItem[] = [];
  for (const p of projects) {
    const cards = await ctx.db.query<Card>(P.cards(p.id));
    for (const c of cards) {
      if (c.status === 'archived') continue;
      for (const w of c.warnings ?? []) {
        const cat = INBOX_CATEGORIES.find((x) => x.codes.includes(w.code));
        if (cat) items.push({ category: cat.key, label: cat.label, projectId: p.id, projectName: p.name, cardId: c.id, cardName: c.name, message: w.message, thumbKey: c.thumbKey });
      }
      if (c.status === 'needs_review') {
        items.push({ category: 'awaiting', label: 'Awaiting approval', projectId: p.id, projectName: p.name, cardId: c.id, cardName: c.name, message: 'Ready for review.', thumbKey: c.thumbKey });
      }
    }
    const changes = await ctx.db.query<SourceChange>(P.changes(p.id), { where: [['status', '==', 'pending']], limit: 100 });
    for (const ch of changes) {
      items.push({ category: 'source_changed', label: 'Website source changed', projectId: p.id, projectName: p.name, cardId: null, cardName: null,
        message: `${ch.kind.replace('_', ' ')}: ${ch.before ?? '—'} → ${ch.after ?? '—'}`, thumbKey: null, changeId: ch.id });
    }
  }
  const failed = await ctx.db.query<Job>(P.jobs, { where: [['status', '==', 'failed']], limit: 200 });
  for (const j of failed) {
    if (!j.projectId || !names.has(j.projectId)) continue;
    const category = j.type === 'ingest' ? 'failed_scrape' : j.type.startsWith('ai.image') ? 'failed_generation' : j.type === 'render' ? 'failed_generation' : 'failed_scrape';
    items.push({ category, label: INBOX_CATEGORIES.find((c) => c.key === category)?.label ?? 'Failed job', projectId: j.projectId, projectName: names.get(j.projectId)!,
      cardId: j.cardId, cardName: null, message: j.error ?? 'Failed', thumbKey: null, jobId: j.id });
  }
  const failedScans = await ctx.db.query<Scan>(P.scans, { where: [['status', '==', 'failed']], limit: 50 });
  for (const s of failedScans) {
    if (!names.has(s.projectId)) continue;
    items.push({ category: 'failed_scrape', label: 'Failed scrape', projectId: s.projectId, projectName: names.get(s.projectId)!, cardId: null, cardName: null, message: s.error ?? 'Scan failed', thumbKey: null });
  }
  return items;
}
