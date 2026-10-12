/**
 * Render a card version: the preview that the grid, history and review use. Same CardScene the
 * editor shows (PRD §54). Also measures the layout and contrast warnings, and — for an Arnifi Light
 * card's first render — adds relight.py's depth boost when the key line falls below WCAG AA.
 */
import sharp from 'sharp';
import { LIGHT_BOOST, diffOverrides, layoutWarnings, updateLayer } from '@acs/renderer';
import { P, designOfVersion, recomputeStats, revisionCached, SOURCE_CODES, type Ctx } from '@acs/firestore';
import { legacyKeyLineRegion, textContrast } from '@acs/raster';
import { projectKey } from '@acs/storage';
import type { Card, CardVersion, CardWarning, Design, GradientLayer, Job, TextLayer } from '@acs/types';
import { fontCss, rasterizer, store, WS } from '../env';
import { resolverFor } from './resolve';

const MIN_CONTRAST = 4.5;

async function renderOnce(ctx: Ctx, d: Design) {
  const { resolveSrc, pending } = await resolverFor(ctx, d, 'preview');
  if (pending.length) return { pending };
  const r = await (await rasterizer()).render(d, { resolveSrc, fontCss: fontCss(), scale: 1, format: 'jpg', quality: 88 });
  const raw = await sharp(r.buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { r, raw };
}

function contrastOf(d: Design, raw: { data: Buffer; info: { width: number; height: number } }, boxes: Record<string, { x: number; y: number; w: number; h: number }>) {
  const sub = d.layers.find((l) => l.id === 'subheading' && l.visible) as TextLayer | undefined;
  const head = d.layers.find((l) => l.id === 'headline' && l.visible) as TextLayer | undefined;
  const t = sub?.text ? sub : head?.text ? head : null;
  if (!t) return null;
  const box = boxes[t.id];
  const region = box ? { x: box.x - 8, y: box.y - 8, w: Math.max(box.w, 300) + 16, h: box.h + 16 } : legacyKeyLineRegion(d.canvas.width, d.canvas.height);
  return { layer: t, value: textContrast(raw.data, raw.info.width, raw.info.height, region, t.color) };
}

export async function render(ctx: Ctx, job: Job) {
  const { projectId, cardId, versionId, initial } = job.input as { projectId: string; cardId: string; versionId: string; initial?: boolean };
  const card = await ctx.db.get<Card>(P.card(projectId, cardId));
  let version = await ctx.db.get<CardVersion>(P.version(projectId, cardId, versionId));
  if (!card || !version) return { skipped: 'card or version gone' };
  let design = await designOfVersion(ctx, version);
  let out = await renderOnce(ctx, design);
  if ('pending' in out) return { waitingFor: out.pending };   // ingest re-queues this when the image lands
  let { r, raw } = out;
  let contrast = contrastOf(design, raw, r.boxes);
  let note: string | null = null;

  const g = design.layers.find((l) => l.type === 'gradient') as GradientLayer | undefined;
  if (initial && contrast && contrast.value < MIN_CONTRAST && g?.visible && g.preset === 'arnifi-light' && !g.fills.some((f) => f.name === 'boost')) {
    const before = contrast.value;
    design = updateLayer(design, g.id, { fills: [...g.fills, JSON.parse(JSON.stringify(LIGHT_BOOST))] } as Partial<GradientLayer>);
    const again = await renderOnce(ctx, design);
    if (!('pending' in again)) {
      ({ r, raw } = again);
      contrast = contrastOf(design, raw, r.boxes);
      note = `depth boost for key line contrast ${before.toFixed(2)} → ${contrast!.value.toFixed(2)}:1`;
      const rev = await revisionCached(ctx, projectId, version.defaultsRev);
      const overrides = diffOverrides(rev.base, design);
      await ctx.db.update(P.version(projectId, cardId, versionId), { overrides, reason: `${version.reason} (${note})` });
      version = { ...version, overrides };
    }
  }

  const s = store();
  const previewKey = projectKey(WS, projectId, 'previews', `${cardId}-${versionId}.jpg`);
  const thumbKey = projectKey(WS, projectId, 'previews', `${cardId}-${versionId}.thumb.webp`);
  const thumb = await sharp(r.buffer).resize(480, null, { kernel: 'lanczos3' }).webp({ quality: 82 }).toBuffer();
  await Promise.all([s.put(previewKey, r.buffer, 'image/jpeg'), s.put(thumbKey, thumb, 'image/webp')]);
  await ctx.db.update(P.version(projectId, cardId, versionId), { previewKey, thumbKey });

  // warnings from the rendered layout; source warnings (low-res, duplicate, …) are kept
  const warnings: CardWarning[] = layoutWarnings(design, r.boxes);
  if (contrast && contrast.value < MIN_CONTRAST) {
    warnings.push({ code: 'key_line_contrast', severity: 'warning', message: `${contrast.layer.role === 'subheading' ? 'Key line' : 'Headline'} contrast is ${contrast.value.toFixed(2)}:1 (WCAG AA is 4.5:1).` });
  }
  const logo = design.layers.find((l) => l.type === 'logo' && l.visible);
  if (logo && r.boxes[logo.id]) {
    const lc = textContrast(raw.data, raw.info.width, raw.info.height, r.boxes[logo.id], '#ffffff');
    if (lc < 3) warnings.push({ code: 'logo_contrast', severity: 'warning', message: `Logo contrast may be insufficient (${lc.toFixed(2)}:1).` });
  }
  if (r.broken.length) warnings.push({ code: 'failed_render', severity: 'error', message: 'An image could not be loaded for the render.' });

  const fresh = (await ctx.db.get<Card>(P.card(projectId, cardId)))!;
  if (fresh.currentVersionId === versionId) {
    const keep = fresh.warnings.filter((w) => SOURCE_CODES.has(w.code) || w.code === 'rejected_image');
    await ctx.db.update(P.card(projectId, cardId), {
      previewKey, thumbKey, warnings: [...keep, ...warnings], updatedAt: new Date().toISOString(),
      stage: fresh.stage === 'approved' || fresh.stage === 'exported' ? fresh.stage : 'needs_review',
      status: fresh.status === 'draft' ? 'needs_review' : fresh.status,
    });
    await recomputeStats(ctx, projectId);
  }
  return { previewKey, thumbKey, contrast: contrast?.value ?? null, note, warnings: warnings.map((w) => w.code) };
}
