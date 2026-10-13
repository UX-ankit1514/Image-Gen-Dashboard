/** Fetch (or read), validate, analyse and store one image; flag it; re-render cards waiting on it. */
import { P, assetWarnings, SOURCE_CODES, type Ctx, enqueue } from '@acs/firestore';
import { analyse, flagsFor, safeFetch } from '@acs/scraper';
import { DHASH_DUPLICATE, hamming, MAX_REMOTE_BYTES, sha256Hex, sniffImage } from '@acs/shared';
import { projectKey, variantKey, type Folder } from '@acs/storage';
import type { Asset, Card, Job, Project } from '@acs/types';
import { store, WS } from '../env';

const FOLDER: Record<string, Folder> = { website: 'source', upload: 'uploaded', screenshot: 'uploaded', generated: 'generated', import: 'source', global: 'source', render: 'previews' };

export async function ingest(ctx: Ctx, job: Job) {
  const { assetId, mode, url } = job.input as { assetId: string; mode: 'remote' | 'stored'; url?: string };
  const asset = await ctx.db.get<Asset>(P.asset(assetId));
  if (!asset) throw new Error(`asset ${assetId} missing`);
  let bytes: Uint8Array;
  if (mode === 'remote') {
    bytes = (await safeFetch(url ?? asset.sourceUrl!, { maxBytes: MAX_REMOTE_BYTES })).bytes;
  } else {
    bytes = await store().getBytes(asset.storageKey);
  }
  const kind = sniffImage(bytes);
  if (!kind || kind === 'svg') throw new Error(`unsupported image (${kind ?? 'unknown type'})`);
  const a = await analyse(bytes, kind);
  const sha256 = await sha256Hex(bytes);
  const project = asset.projectId ? await ctx.db.get<Project>(P.project(asset.projectId)) : null;
  const folder = FOLDER[asset.source] ?? 'source';
  const base = asset.projectId ? projectKey(WS, asset.projectId, folder, `${asset.id}.${a.ext}`) : `ws/${WS}/global/${asset.id}.${a.ext}`;
  const storageKey = mode === 'remote' || a.resampledFrom || !asset.storageKey ? base : asset.storageKey;
  const thumbKey = variantKey(storageKey, 'thumb', 'webp');
  const previewKey = variantKey(storageKey, 'preview', 'webp');
  const s = store();
  await Promise.all([
    storageKey !== asset.storageKey || a.resampledFrom ? s.put(storageKey, a.original, a.mime) : Promise.resolve(),
    s.put(thumbKey, a.thumb, 'image/webp'),
    s.put(previewKey, a.preview, 'image/webp'),
  ]);

  const flags: Asset['flags'] = { ...asset.flags, ...flagsFor(a, project ? { width: project.width, height: project.height } : undefined) };
  flags.hasAlpha = a.hasAlpha;
  // duplicate detection by hash and perceptual hash (PRD §47)
  if (asset.projectId) {
    const siblings = await ctx.db.query<Asset>(P.assets, { where: [['projectId', '==', asset.projectId]] });
    const dup = siblings.find((o) => o.id !== asset.id && o.status === 'ready' && (o.sha256 === sha256 || (o.dhash && hamming(o.dhash, a.dhash) <= DHASH_DUPLICATE)));
    flags.duplicateOf = dup?.id ?? null;
  }
  const ready: Partial<Asset> = {
    status: 'ready', error: null, storageKey, thumbKey, previewKey, width: a.width, height: a.height, mimeType: a.mime,
    bytes: a.original.length, sha256, dhash: a.dhash, inkScore: a.inkScore, flags,
  };
  if (a.resampledFrom) (ready as Record<string, unknown>).resampledFrom = a.resampledFrom;
  await ctx.db.update(P.asset(asset.id), ready);

  // cards created before this image finished: refresh their source warnings and render them now
  if (asset.projectId) {
    const cards = await ctx.db.query<Card>(P.cards(asset.projectId), { where: [['backgroundAssetId', '==', asset.id]] });
    const fresh = { ...asset, ...ready } as Asset;
    for (const c of cards) {
      const warnings = [...c.warnings.filter((w) => !SOURCE_CODES.has(w.code) || w.code === 'no_highlights' || w.code.startsWith('source_')), ...assetWarnings(fresh)];
      await ctx.db.update(P.card(asset.projectId, c.id), { warnings });
      if (!c.thumbKey && c.currentVersionId) {
        await enqueue(ctx, { type: 'render', projectId: asset.projectId, cardId: c.id, input: { projectId: asset.projectId, cardId: c.id, versionId: c.currentVersionId, purpose: 'preview', initial: c.versionCount === 1 } });
      }
    }
  }
  return { width: a.width, height: a.height, flags, resampledFrom: a.resampledFrom };
}
