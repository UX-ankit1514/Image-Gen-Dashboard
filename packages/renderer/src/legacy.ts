/**
 * Legacy card records → Design JSON. Used by the importer (existing runs become projects) and by
 * the parity harness, which renders these designs and diffs them against the shipped JPGs.
 *
 *  classic: an arnifi-studio run record (data.json + INDEX.csv): h1, key line, _focus
 *  light:   a relight.py sources.json entry: title, kicker, focus, stack, boost, layout, suffix
 */
import type { Design, GradientLayer, TextLayer } from '@acs/types';
import { buildRecipe } from './recipes';
import { LIGHT_BOOST } from './presets';
import { updateLayer } from './resolve';

export interface LegacyCard {
  recipe: 'arnifi-classic' | 'arnifi-light';
  photoRef: string;
  title: string;
  kicker: string;
  /** CSS object-position as the legacy code wrote it: "center 42%", "32% 46%". */
  focus?: string;
  /** relight `stack`: 'legacy' cards were rendered with no web fonts (system serif/sans). */
  stack?: 'studio' | 'legacy';
  boost?: boolean;
  layout?: { h1_px?: number; bottom?: number; kicker_gap?: number; nowrap?: boolean; suffix_em?: number };
  suffix?: string;
  headlineProvenance?: TextLayer['provenance'];
  kickerProvenance?: TextLayer['provenance'];
}

export function parseFocus(focus?: string): { focalX: number; focalY: number } {
  const parts = (focus || 'center 42%').trim().split(/\s+/);
  const v = (p: string | undefined, dflt: number) => {
    if (!p || p === 'center') return 0.5;
    if (p === 'left' || p === 'top') return 0;
    if (p === 'right' || p === 'bottom') return 1;
    const n = parseFloat(p);
    return Number.isFinite(n) ? n / 100 : dflt;
  };
  return { focalX: v(parts[0], 0.5), focalY: v(parts[1] ?? parts[0], 0.42) };
}

/** card.kicker(): trailing punctuation is stripped. */
export function cleanKicker(k: string) {
  return (k || '').replace(/[\s:;,.-]+$/, '');
}

export function designFromLegacy(c: LegacyCard): Design {
  let d = buildRecipe(c.recipe);
  const { focalX, focalY } = parseFocus(c.focus);
  d = updateLayer(d, 'background', { assetId: c.photoRef, source: 'website', focalX, focalY } as never);

  const legacyFonts = c.stack === 'legacy';
  const head = d.layers.find((l) => l.id === 'headline') as TextLayer;
  const headPatch: Partial<TextLayer> = {
    text: c.title,
    provenance: c.headlineProvenance ?? { kind: 'website-h1', original: c.title },
    fontFamily: legacyFonts ? 'serif' : 'Lora',
  };
  if (c.layout?.h1_px != null) Object.assign(headPatch, { fontSize: c.layout.h1_px, autoSize: null });
  if (c.layout?.bottom != null) headPatch.y = d.canvas.height - c.layout.bottom;
  if (c.layout?.nowrap) headPatch.nowrap = true;
  if (c.suffix) headPatch.suffix = { text: c.suffix, em: c.layout?.suffix_em ?? 0.6 };
  d = updateLayer(d, 'headline', { ...head, ...headPatch } as never);

  const subPatch: Partial<TextLayer> = {
    text: c.kicker,
    provenance: c.kickerProvenance ?? { kind: 'page-highlight', original: c.kicker, ref: 'highlight:0' },
    fontFamily: legacyFonts ? 'sans-serif' : 'Inter',
  };
  if (c.layout?.kicker_gap != null) subPatch.stackGap = c.layout.kicker_gap;
  d = updateLayer(d, 'subheading', subPatch as never);

  if (c.boost) {
    const g = d.layers.find((l) => l.id === 'gradient') as GradientLayer;
    d = updateLayer(d, 'gradient', { fills: [...g.fills, JSON.parse(JSON.stringify(LIGHT_BOOST))] } as never);
  }
  return d;
}
