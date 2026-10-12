import { describe, expect, it } from 'vitest';
import type { Design, TextLayer } from '@acs/types';
import { buildRecipe } from './recipes';
import { applyOverrides, diffOverrides, effectiveFontSize, getLayer, ladderSize, updateLayer } from './resolve';
import { resizeDesign } from './resize';
import { cleanKicker, designFromLegacy, parseFocus } from './legacy';
import { layoutWarnings } from './validate';
import { LEGACY_LADDER } from './recipes';

describe('overrides', () => {
  const base = buildRecipe('arnifi-light');

  it('round-trips: apply(base, diff(base, d)) === d', () => {
    let d = updateLayer(base, 'headline', { text: 'Ireland Company Setup' } as Partial<TextLayer>);
    d = updateLayer(d, 'logo', { visible: false });
    d = { ...d, layers: [...d.layers, { ...getLayer(d, 'logo')!, id: 'logo-2', name: 'Logo 2', x: 900 }] };
    const o = diffOverrides(base, d);
    expect(applyOverrides(base, o)).toEqual(d);
  });

  it('stores only what changed', () => {
    const d = updateLayer(base, 'gradient', { opacity: 0.8 });
    const o = diffOverrides(base, d);
    expect(o).toEqual({ layers: { gradient: { opacity: 0.8 } } });
  });

  it('records deletions and reorders', () => {
    const d: Design = { ...base, layers: [...base.layers].reverse().filter((l) => l.id !== 'logo') };
    const o = diffOverrides(base, d);
    expect(o.layers?.logo).toBeNull();
    expect(applyOverrides(base, o).layers.map((l) => l.id)).toEqual(d.layers.map((l) => l.id));
  });

  it('project defaults reach cards that did not override the property', () => {
    const card = diffOverrides(base, updateLayer(base, 'headline', { text: 'A' } as Partial<TextLayer>));
    const newBase = updateLayer(base, 'gradient', { opacity: 0.5 });
    const resolved = applyOverrides(newBase, card);
    expect(getLayer(resolved, 'gradient')!.opacity).toBe(0.5);
    expect((getLayer(resolved, 'headline') as TextLayer).text).toBe('A');
  });
});

describe('legacy size ladder (card.py fsize)', () => {
  it.each([
    ['x'.repeat(34), 66], ['x'.repeat(35), 58], ['x'.repeat(48), 58], ['x'.repeat(49), 52], ['x'.repeat(62), 52], ['x'.repeat(63), 46],
  ])('%s chars', (t, px) => {
    expect(ladderSize(t, LEGACY_LADDER)).toBe(px);
  });

  it('manual size wins once autoSize is cleared', () => {
    const h = getLayer(buildRecipe('arnifi-light'), 'headline', 'text')!;
    expect(effectiveFontSize({ ...h, text: 'short', autoSize: null, fontSize: 40 })).toBe(40);
  });
});

describe('legacy mapping', () => {
  it('parses object-position strings', () => {
    expect(parseFocus('center 42%')).toEqual({ focalX: 0.5, focalY: 0.42 });
    expect(parseFocus('32% 46%')).toEqual({ focalX: 0.32, focalY: 0.46 });
  });
  it('strips trailing punctuation from key lines', () => {
    expect(cleanKicker('Streamlined Processes.')).toBe('Streamlined Processes');
  });
  it('applies relight layout overrides', () => {
    const d = designFromLegacy({ recipe: 'arnifi-light', photoRef: 'p', title: 'T', kicker: 'K', layout: { h1_px: 53.9, bottom: 73, kicker_gap: 9 }, boost: true });
    const h = getLayer(d, 'headline', 'text')!;
    expect(h.fontSize).toBe(53.9);
    expect(h.autoSize).toBeNull();
    expect(h.y).toBe(927);
    expect(getLayer(d, 'subheading', 'text')!.stackGap).toBe(9);
    expect(getLayer(d, 'gradient', 'gradient')!.fills.at(-1)!.name).toBe('boost');
  });
});

describe('resize (PRD §28)', () => {
  const base = buildRecipe('arnifi-light');

  it('scale: full-frame layers follow the canvas, positions stay relative, sizes scale by min(sx, sy)', () => {
    const r = resizeDesign(base, 1080, 1350, 'scale');
    expect(r.canvas).toMatchObject({ width: 1080, height: 1350 });
    const bg = getLayer(r, 'background')!;
    expect([bg.x, bg.y, bg.width, bg.height]).toEqual([0, 0, 1080, 1350]);
    const logo = getLayer(r, 'logo')!;
    expect(logo.x).toBeCloseTo(64 * 0.675, 1);
    expect(logo.y).toBeCloseTo(52 * 1.35, 1);
    expect(logo.width).toBeCloseTo(196 * 0.675, 1);
    const h = getLayer(r, 'headline', 'text')!;
    expect(h.autoSize!.steps[0].size).toBeCloseTo(66 * 0.675, 1);
  });

  it('keep: element sizes untouched', () => {
    const r = resizeDesign(base, 1920, 1080, 'keep');
    expect(getLayer(r, 'logo')!.width).toBe(196);
  });

  it('reflow: text stays bottom-anchored with scaled margins', () => {
    const r = resizeDesign(base, 1080, 1920, 'reflow');
    const h = getLayer(r, 'headline', 'text')!;
    const s = Math.min(1080 / 1600, 1920 / 1000);
    expect(h.y).toBeCloseTo(1920 - 64 * s, 1);
    expect(h.x).toBeCloseTo(64 * s, 1);
  });
});

describe('layout warnings', () => {
  it('flags overflow, empty heading, and logo collisions', () => {
    let d = buildRecipe('arnifi-light');
    d = updateLayer(d, 'headline', { text: 'A very long headline', maxLines: 2 } as Partial<TextLayer>);
    const w = layoutWarnings(d, {
      headline: { x: 64, y: 700, w: 1400, h: 240, lines: 3 },
      logo: { x: 64, y: 690, w: 196, h: 55 },
    });
    const codes = w.map((x) => x.code);
    expect(codes).toContain('headline_overflow');
    expect(codes).toContain('missing_subheading');
    expect(codes).toContain('logo_conflict');
  });
});
