/** Asset ids in a design → URLs headless Chrome can load. */
import { builtinFileUrl } from '@acs/renderer/node';
import { isBuiltin } from '@acs/renderer';
import { P, type Ctx } from '@acs/firestore';
import type { Asset, Design } from '@acs/types';
import { ASSETS, store } from '../env';

export function assetIdsOf(d: Design) {
  const ids = new Set<string>();
  for (const l of d.layers) {
    if (!l.visible) continue;
    if ((l.type === 'background' || l.type === 'image') && l.assetId) ids.add(l.assetId);
    if (l.type === 'logo' && !isBuiltin(l.src)) ids.add(l.src);
    if (l.type === 'gradient') for (const f of l.fills) if ((f.kind === 'image' || f.kind === 'pattern') && !isBuiltin(f.src)) ids.add(f.src);
  }
  return [...ids];
}

/** `variant`: previews load the ≤2000 px variant; exports always the stored original. */
export async function resolverFor(ctx: Ctx, d: Design, variant: 'preview' | 'original') {
  const ids = assetIdsOf(d);
  const assets = (await ctx.db.getMany<Asset>(ids.map((id) => P.asset(id)))).filter(Boolean) as Asset[];
  const urls = new Map<string, string>();
  const pending: string[] = [];
  for (const a of assets) {
    if (a.status !== 'ready' || !a.storageKey) { pending.push(a.id); continue; }
    const key = variant === 'preview' && a.previewKey && a.width > 2000 ? a.previewKey : a.storageKey;
    urls.set(a.id, await store().signedUrl(key, 3600));
  }
  const resolveSrc = (ref: string) => (isBuiltin(ref) ? builtinFileUrl(ref, ASSETS) : urls.get(ref) ?? null);
  return { resolveSrc, pending, assets };
}
