/**
 * Export (PRD §67–69): render each card's approved version (or, with consent, its current one) at
 * the requested format and scale from the original assets, then the extras the legacy workflow
 * produced — contact sheet, INDEX.csv (legacy columns), links / source-URL index and a manifest —
 * all in one ZIP.
 */
import { ZipArchive } from 'archiver';
import sharp from 'sharp';
import { P, designOfVersion, recomputeStats, type Ctx } from '@acs/firestore';
import { renderName, toCsv, uniqueNames } from '@acs/shared';
import { projectKey } from '@acs/storage';
import type { Card, CardVersion, ExportRecord, Job, Project, SourcePage, TextLayer } from '@acs/types';
import { fontCss, rasterizer, store, WS } from '../env';
import { resolverFor } from './resolve';

const LEGACY_COLUMNS = ['file', 'headline', 'key_point', 'authority', 'country', 'est_time', 'price', 'page_url', 'source_photo', 'headline_source', 'key_line_source', 'photo_flag'];
const EXTRA_COLUMNS = ['version', 'approved', 'status', 'width', 'height', 'card_id'];

async function contactSheet(images: Buffer[], aspect: number) {
  // legacy render.contact_sheet: 6 columns of 520×325 on #0b0922, JPEG 88
  const cols = Math.min(6, Math.max(1, images.length));
  const tw = 520;
  const th = Math.round(tw / aspect);
  const rows = Math.ceil(images.length / cols);
  const tiles = await Promise.all(images.map((b) => sharp(b).resize(tw, th, { fit: 'fill', kernel: 'lanczos3' }).toBuffer()));
  return sharp({ create: { width: cols * tw, height: rows * th, channels: 3, background: '#0b0922' } })
    .composite(tiles.map((input, i) => ({ input, left: (i % cols) * tw, top: Math.floor(i / cols) * th })))
    .jpeg({ quality: 88, progressive: true })
    .toBuffer();
}

function zip(entries: { name: string; data: Buffer | string }[]) {
  return new Promise<Buffer>((resolve, reject) => {
    const z = new ZipArchive({ zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    z.on('data', (c: Buffer) => chunks.push(c));
    z.on('error', reject);
    z.on('end', () => resolve(Buffer.concat(chunks)));
    for (const e of entries) z.append(e.data, { name: e.name });
    void z.finalize();
  });
}

export async function runExport(ctx: Ctx, job: Job) {
  const { exportId } = job.input as { exportId: string };
  const rec = await ctx.db.get<ExportRecord>(P.export(exportId));
  if (!rec) throw new Error('export record missing');
  await ctx.db.update(P.export(exportId), { status: 'running' });
  const project = (await ctx.db.get<Project>(P.project(rec.projectId)))!;
  const raster = await rasterizer();
  const ext = rec.format === 'jpg' ? 'jpg' : rec.format;
  const s = store();

  const rendered: { card: Card; version: CardVersion; buffer: Buffer; approved: boolean; page: SourcePage | null; design: Awaited<ReturnType<typeof designOfVersion>> }[] = [];
  for (const f of rec.files) {
    const card = await ctx.db.get<Card>(P.card(rec.projectId, f.cardId));
    const version = await ctx.db.get<CardVersion>(P.version(rec.projectId, f.cardId, f.versionId));
    if (!card || !version) continue;
    const design = await designOfVersion(ctx, version);
    const { resolveSrc, pending } = await resolverFor(ctx, design, 'original');
    if (pending.length) throw new Error(`images still processing for ${card.name}`);
    const r = await raster.render(design, { resolveSrc, fontCss: fontCss(), scale: rec.scale, format: rec.format });
    const page = card.sourcePageId ? await ctx.db.get<SourcePage>(P.page(rec.projectId, card.sourcePageId)) : null;
    rendered.push({ card, version, buffer: r.buffer, approved: f.approved, page, design });
  }

  const names = uniqueNames(rendered.map((x, i) => renderName(rec.options.namingTemplate, {
    project: project.name, card: x.card.name, version: x.version.number, n: i + 1,
    w: Math.round(x.design.canvas.width * rec.scale), h: Math.round(x.design.canvas.height * rec.scale),
    country: x.page?.country ?? '', status: x.approved ? 'approved' : x.card.status,
  }, ext)));

  const files: ExportRecord['files'] = [];
  for (let i = 0; i < rendered.length; i++) {
    const x = rendered[i];
    const key = projectKey(WS, rec.projectId, 'exports', `${exportId}/${names[i]}`);
    await s.put(key, x.buffer, rec.format === 'jpg' ? 'image/jpeg' : `image/${rec.format}`);
    files.push({ cardId: x.card.id, versionId: x.version.id, name: names[i], key, approved: x.approved });
  }

  const entries: { name: string; data: Buffer | string }[] = rendered.map((x, i) => ({ name: names[i], data: x.buffer }));
  const rows = rendered.map((x, i) => {
    const head = x.design.layers.find((l) => l.id === 'headline') as TextLayer | undefined;
    const sub = x.design.layers.find((l) => l.id === 'subheading') as TextLayer | undefined;
    const bg = x.design.layers.find((l) => l.type === 'background');
    return {
      file: names[i], headline: head?.text ?? '', key_point: sub?.text ?? '', authority: x.page?.authority ?? '', country: x.page?.country ?? '',
      est_time: x.page?.estTime ?? '', price: x.page?.price ?? '', page_url: x.page?.url ?? '',
      source_photo: bg && bg.type === 'background' ? bg.assetId ?? '' : '', headline_source: head?.provenance.kind ?? '',
      key_line_source: sub ? sub.provenance.ref ?? sub.provenance.kind : '',      // legacy: "highlight:0"
      photo_flag: x.card.warnings.filter((w) => ['text_in_photo', 'possible_text', 'low_res', 'duplicate'].includes(w.code)).map((w) => w.code).join(' '),
      version: `v${x.version.number}`, approved: x.approved ? 'yes' : 'no', status: x.card.status,
      width: Math.round(x.design.canvas.width * rec.scale), height: Math.round(x.design.canvas.height * rec.scale), card_id: x.card.id,
    };
  });
  if (rec.options.csv) {
    entries.push({ name: 'INDEX.csv', data: toCsv(rows, [...LEGACY_COLUMNS, ...EXTRA_COLUMNS]) });
    entries.push({ name: 'links.txt', data: rows.map((r) => r.page_url).filter(Boolean).join('\n') + '\n' });
    entries.push({ name: 'SOURCE-URLS.csv', data: toCsv(rows.map((r) => ({ file: r.file, page_url: r.page_url, headline: r.headline })), ['file', 'page_url', 'headline']) });
  }
  if (rec.options.contactSheet && rendered.length) {
    const aspect = rendered[0].design.canvas.width / rendered[0].design.canvas.height;
    entries.push({ name: 'CONTACT-SHEET.jpg', data: await contactSheet(rendered.map((x) => x.buffer), aspect) });
  }
  if (rec.options.manifest) {
    entries.push({ name: 'manifest.json', data: JSON.stringify({
      project: { id: project.id, name: project.name }, exportId, createdAt: rec.createdAt, format: rec.format, scale: rec.scale,
      scope: rec.scope, includesUnapproved: rec.includesUnapproved,
      files: rendered.map((x, i) => ({ file: names[i], card: x.card.name, cardId: x.card.id, version: x.version.number, versionId: x.version.id,
        approved: x.approved, reason: x.version.reason, page: x.page?.url ?? null })),
    }, null, 2) });
  }
  const zipBuf = await zip(entries);
  const zipKey = projectKey(WS, rec.projectId, 'exports', `${exportId}/${project.slug || 'export'}-${exportId.slice(-6)}.zip`);
  await s.put(zipKey, zipBuf, 'application/zip');

  const t = new Date().toISOString();
  await ctx.db.update(P.export(exportId), { status: 'completed', zipKey, files, completedAt: t, error: null });
  for (const x of rendered) {
    if (x.approved && (x.card.status === 'approved' || x.card.status === 'exported')) {
      await ctx.db.update(P.card(rec.projectId, x.card.id), { status: 'exported', stage: 'exported', updatedAt: t });
    }
  }
  const all = await ctx.db.query<Card>(P.cards(rec.projectId));
  const approved = all.filter((c) => c.approvedVersionId && c.status !== 'archived');
  const exported = approved.filter((c) => c.status === 'exported' || rendered.some((x) => x.card.id === c.id && x.approved));
  await ctx.db.update(P.project(rec.projectId), { exportStatus: exported.length && exported.length >= approved.length ? 'exported' : 'partial', lastExportAt: t });
  await recomputeStats(ctx, rec.projectId);
  return { files: files.length, zipKey, bytes: zipBuf.length };
}
