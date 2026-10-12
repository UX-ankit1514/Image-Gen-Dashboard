/** Storage keys → presigned URLs in API responses (signed asset URLs, PRD §78). */
import type { Storage } from '@acs/storage';
import type { Asset, Card, CardVersion, Design, ExportRecord, Project } from '@acs/types';

const sign = (s: Storage, key?: string | null) => (key ? s.signedUrl(key) : Promise.resolve(null));

export async function cardUrls(s: Storage, cards: Card[]) {
  return Promise.all(cards.map(async (c) => ({ ...c, thumbUrl: await sign(s, c.thumbKey), previewUrl: await sign(s, c.previewKey) })));
}

export async function versionUrls(s: Storage, versions: CardVersion[]) {
  return Promise.all(versions.map(async (v) => ({ ...v, thumbUrl: await sign(s, v.thumbKey), previewUrl: await sign(s, v.previewKey) })));
}

export async function assetUrls(s: Storage, assets: Asset[]) {
  return Promise.all(assets.map(async (a) => ({
    ...a,
    url: await sign(s, a.storageKey || null),
    thumbUrl: await sign(s, a.thumbKey ?? (a.status === 'ready' ? a.storageKey : null)),
    previewUrl: await sign(s, a.previewKey ?? (a.storageKey || null)),
  })));
}

export async function projectUrls(s: Storage, projects: Project[]) {
  return Promise.all(projects.map(async (p) => ({ ...p, coverUrls: await Promise.all((p.coverThumbs ?? []).map((k) => s.signedUrl(k))) })));
}

export async function exportUrls(s: Storage, e: ExportRecord, projectName?: string) {
  return {
    ...e,
    zipUrl: e.zipKey ? await s.signedUrl(e.zipKey, 6 * 3600, `${(projectName ?? 'export').replace(/[^\w.-]+/g, '-')}.zip`) : null,
    fileUrls: await Promise.all(e.files.filter((f) => f.key).map(async (f) => ({ name: f.name, url: await s.signedUrl(f.key, 6 * 3600, f.name) }))),
  };
}

export function designAssetIds(d: Design) {
  const ids = new Set<string>();
  for (const l of d.layers) {
    if ((l.type === 'background' || l.type === 'image') && l.assetId) ids.add(l.assetId);
    if (l.type === 'logo' && !l.src.startsWith('builtin:')) ids.add(l.src);
    if (l.type === 'gradient') for (const f of l.fills) if ((f.kind === 'image' || f.kind === 'pattern') && !f.src.startsWith('builtin:')) ids.add(f.src);
  }
  return [...ids];
}
