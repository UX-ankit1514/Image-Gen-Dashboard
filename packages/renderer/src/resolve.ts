/**
 * Project default + card override → the design that renders (PRD §40).
 *
 * The editor works on a full Design; what gets stored is the sparse difference from the
 * project's base, so a project-level change (a new gradient for everyone) reaches every card that
 * did not override that property, and nothing is duplicated per card.
 */
import type { Design, Layer, Overrides, TextLayer } from '@acs/types';

const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function applyOverrides(base: Design, o?: Overrides | null): Design {
  const out: Design = clone(base);
  if (!o) return out;
  if (o.canvas) out.canvas = { ...out.canvas, ...o.canvas };
  let layers: Layer[] = [];
  for (const l of out.layers) {
    const patch = o.layers?.[l.id];
    if (patch === null) continue;                       // deleted on this card
    layers.push(patch ? ({ ...l, ...clone(patch) } as Layer) : l);
  }
  for (const extra of o.extra ?? []) {
    if (!layers.some((l) => l.id === extra.id)) layers.push(clone(extra));
  }
  if (o.order?.length) {
    const rank = new Map(o.order.map((id, i) => [id, i]));
    layers = layers
      .map((l, i) => ({ l, k: rank.has(l.id) ? rank.get(l.id)! : o.order!.length + i }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.l);
  }
  out.layers = layers;
  return out;
}

/** The smallest Overrides that turns `base` into `design`. */
export function diffOverrides(base: Design, design: Design): Overrides {
  const o: Overrides = {};
  const canvas: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(design.canvas)) {
    if (!same((base.canvas as Record<string, unknown>)[k], v)) canvas[k] = clone(v);
  }
  if (Object.keys(canvas).length) o.canvas = canvas;

  const baseById = new Map(base.layers.map((l) => [l.id, l]));
  const layers: Record<string, Record<string, unknown> | null> = {};
  const extra: Layer[] = [];
  for (const l of design.layers) {
    const b = baseById.get(l.id);
    if (!b || b.type !== l.type) {
      extra.push(clone(l));
      if (b) layers[l.id] = null;
      continue;
    }
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(l)) {
      if (!same((b as Record<string, unknown>)[k], v)) patch[k] = clone(v);
    }
    if (Object.keys(patch).length) layers[l.id] = patch;
  }
  const ids = new Set(design.layers.map((l) => l.id));
  for (const b of base.layers) if (!ids.has(b.id)) layers[b.id] = null;
  if (Object.keys(layers).length) o.layers = layers;
  if (extra.length) o.extra = extra;

  // order only matters when it differs from what applyOverrides would produce without it
  const without = applyOverrides(base, { ...o, order: undefined }).layers.map((l) => l.id);
  const actual = design.layers.map((l) => l.id);
  if (!same(without, actual)) o.order = actual;
  return o;
}

export function isEmptyOverrides(o?: Overrides | null) {
  return !o || (!o.canvas && !o.layers && !o.extra?.length && !o.order);
}

/** Merge a later override set on top of an earlier one (draft over version, batch over card). */
export function mergeOverrides(base: Design, first: Overrides | null | undefined, second: Overrides | null | undefined): Overrides {
  return diffOverrides(base, applyOverrides(applyOverrides(base, first), second));
}

/** Ladder sizes are a function of text length (card.py fsize). */
export function ladderSize(text: string, steps: { max: number; size: number }[]) {
  const n = (text || '').length;
  for (const st of steps) if (n <= st.max) return st.size;
  return steps[steps.length - 1]?.size ?? 16;
}

export function effectiveFontSize(l: TextLayer) {
  return l.autoSize?.steps?.length ? ladderSize(l.text, l.autoSize.steps) : l.fontSize;
}

export function getLayer<T extends Layer['type']>(d: Design, id: string, type?: T) {
  const l = d.layers.find((x) => x.id === id);
  if (!l || (type && l.type !== type)) return undefined;
  return l as Extract<Layer, { type: T }>;
}

export function updateLayer(d: Design, id: string, patch: Partial<Layer>): Design {
  return { ...d, layers: d.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)) };
}
