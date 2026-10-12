/** Legacy runs → pages + cards (PRD §12 "Import existing folder", §55 migration). */
import { parseFocus, updateLayer, diffOverrides } from '@acs/renderer';
import { newId, nowIso, slugify } from '@acs/shared';
import type { Asset, BackgroundLayer, Card, CardVersion, SourcePage, TextLayer } from '@acs/types';
import type { WriteOp } from '../db';
import { P } from '../paths';
import { audit } from './audit';
import { assetWarnings } from './cards';
import type { Ctx } from './context';
import { jobOp, makeJob } from './jobs';
import { getProject, getRevision, recomputeStats } from './projects';

export interface ImportRecord {
  name: string; slug: string; h1: string; kicker: string; url: string; country: string | null; authority: string | null;
  price: string | null; estTime: string | null; category: string | null; highlights: { title: string; desc: string }[];
  focus: string; image: string | null; assetId: string; finalAssetId: string | null; position: number;
}

async function pageId(url: string, slug: string) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(url || slug));
  return 'pg_' + [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function importLegacyRecords(ctx: Ctx, projectId: string, records: ImportRecord[]) {
  const project = await getProject(ctx, projectId);
  const rev = await getRevision(ctx, projectId, project.defaultsRev);
  const existing = await ctx.db.query<Card>(P.cards(projectId));
  let order = existing.reduce((m, c) => Math.max(m, c.order), 0);
  const t = nowIso();
  const ops: WriteOp[] = [];
  for (const r of records) {
    const pid = await pageId(r.url, r.slug);
    const page: SourcePage = {
      id: pid, projectId, scanId: 'import', url: r.url, slug: r.slug, pageType: 'detail', title: r.name, name: r.name, h1: r.h1,
      subheading: r.highlights[0]?.title ?? '', highlights: r.highlights, benefits: r.highlights.map((h) => h.desc).filter(Boolean),
      country: r.country, jurisdiction: r.authority, authority: r.authority, category: r.category, price: r.price, estTime: r.estTime,
      images: [{ url: r.image ?? '', role: 'banner', assetId: r.assetId }], relatedLinks: [],
      rawMetadata: { position: r.position, source: 'import' }, status: 'ok', error: null, contentHash: '', lastScannedAt: t,
    };
    ops.push({ kind: 'set', path: P.page(projectId, pid), data: page });
    ops.push({ kind: 'update', path: P.asset(r.assetId), data: { sourcePageId: pid, role: 'banner', sourceUrl: r.image } });
    if (r.finalAssetId) ops.push({ kind: 'update', path: P.asset(r.finalAssetId), data: { sourcePageId: pid, name: `Shipped card: ${r.name}` } });

    let d = rev.base;
    const { focalX, focalY } = parseFocus(r.focus);
    const bg = d.layers.find((l) => l.type === 'background') as BackgroundLayer | undefined;
    if (bg) d = updateLayer(d, bg.id, { assetId: r.assetId, source: 'website', focalX, focalY } as Partial<BackgroundLayer>);
    d = updateLayer(d, 'headline', { text: r.h1, provenance: { kind: 'website-h1', original: r.h1, ref: 'h1' } } as Partial<TextLayer>);
    d = updateLayer(d, 'subheading', { text: r.kicker, provenance: { kind: 'imported', original: r.kicker, ref: 'legacy key line' } } as Partial<TextLayer>);
    const card: Card = {
      id: newId('card'), projectId, sourcePageId: pid, name: r.name, slug: slugify(r.name), order: ++order, status: 'draft', stage: 'image_ready',
      currentVersionId: null, approvedVersionId: null, versionCount: 1, draft: null, draftRev: null, draftUpdatedAt: null, dirty: false,
      backgroundAssetId: r.assetId, thumbKey: null, previewKey: null, warnings: assetWarnings({ flags: {} } as Asset).filter((w) => w.code !== 'missing_image'),
      sourceLabel: 'Import', createdAt: t, updatedAt: t,
    };
    const v: CardVersion = {
      id: newId('ver'), cardId: card.id, projectId, number: 1, width: d.canvas.width, height: d.canvas.height, overrides: diffOverrides(rev.base, d),
      defaultsRev: rev.id, previewKey: null, thumbKey: null, reason: 'Imported from a previous run', actor: ctx.actor, provider: null, prompt: null,
      jobId: null, parentVersionId: null, createdAt: t,
    };
    card.currentVersionId = v.id;
    ops.push({ kind: 'create', path: P.card(projectId, card.id), data: card });
    ops.push({ kind: 'create', path: P.version(projectId, card.id, v.id), data: v });
    ops.push(jobOp(makeJob(ctx, { type: 'render', projectId, cardId: card.id, input: { projectId, cardId: card.id, versionId: v.id, purpose: 'preview' } })));
  }
  for (let i = 0; i < ops.length; i += 450) await ctx.db.commit(ops.slice(i, i + 450));
  await recomputeStats(ctx, projectId);
  await audit(ctx, 'cards.created', 'project', projectId, { count: records.length, source: 'import' });
  return { cards: records.length };
}
