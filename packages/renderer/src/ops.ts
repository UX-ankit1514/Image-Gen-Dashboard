/**
 * Pure design operations shared by the editor, batch edits (PRD §39), project defaults (§40) and
 * AI patches (§23). Each one changes the smallest part of the design it is about (§31).
 */
import type { BackgroundLayer, BackgroundSource, Design, Fill, GradientLayer, GradientPatch, Layer, LinearFill, Stop, TextLayer } from '@acs/types';
import { CUSTOM_GRADIENT_PRESET, customGradientFills, PHOTO_NEUTRAL, presetById, presetFills, type GradientMix } from './presets';
import { getLayer, updateLayer } from './resolve';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}
const rgbToHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

/** Parses #hex, rgb()/rgba() and "transparent" into a stop colour + alpha. */
export function parseColor(input: string): { color: string; alpha: number } | null {
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { color: '#000000', alpha: 0 };
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const [r, g, b, a] = m[1].split(',').map((x) => parseFloat(x));
    return { color: rgbToHex(r, g, b), alpha: Number.isFinite(a) ? clamp(a, 0, 1) : 1 };
  }
  const rgb = hexToRgb(s);
  return rgb ? { color: rgbToHex(...rgb), alpha: 1 } : null;
}

function darkenStop(s: Stop, amount: number): Stop {
  const rgb = hexToRgb(s.color) ?? [0, 0, 0];
  if (amount >= 0) {
    // darker: colour toward black and alpha up, so a translucent wash actually reads darker
    const k = 1 - amount;
    return { ...s, color: rgbToHex(rgb[0] * k, rgb[1] * k, rgb[2] * k), alpha: +clamp(s.alpha + (1 - s.alpha) * amount * 0.6, 0, 1).toFixed(3) };
  }
  const k = -amount;
  return { ...s, alpha: +clamp(s.alpha * (1 - k), 0, 1).toFixed(3) };
}

export function gradientLayerOf(d: Design) {
  return d.layers.find((l) => l.type === 'gradient') as GradientLayer | undefined;
}

export function applyGradientPreset(d: Design, presetId: string, withPhotoGrade = true): Design {
  const g = gradientLayerOf(d);
  const preset = presetById(presetId);
  if (!g || !preset) return d;
  let out = updateLayer(d, g.id, { preset: presetId, fills: presetFills(presetId), visible: presetId !== 'none' ? true : g.visible } as Partial<GradientLayer>);
  const bg = out.layers.find((l) => l.type === 'background') as BackgroundLayer | undefined;
  if (withPhotoGrade && bg && preset.photoAdjust) out = updateLayer(out, bg.id, { adjust: { ...preset.photoAdjust } } as Partial<BackgroundLayer>);
  return out;
}

/** Uses an uploaded gradient image (an asset id) as the gradient, mixed into the photo as chosen.
 *  The photo goes back to neutral: the gradient carries the look. */
export function applyCustomGradient(d: Design, src: string, mix: GradientMix): Design {
  const g = gradientLayerOf(d);
  if (!g) return d;
  let out = updateLayer(d, g.id, { preset: CUSTOM_GRADIENT_PRESET, fills: customGradientFills(src, mix), visible: true } as Partial<GradientLayer>);
  const bg = out.layers.find((l) => l.type === 'background') as BackgroundLayer | undefined;
  if (bg && g.preset !== CUSTOM_GRADIENT_PRESET) out = updateLayer(out, bg.id, { adjust: { ...PHOTO_NEUTRAL } } as Partial<BackgroundLayer>);
  return out;
}

/**
 * A structured gradient change (from the inspector or the AI). Field-level edits apply to the first
 * linear fill; `opacity` is the layer's; `darken` shifts every gradient fill's stops.
 */
export function applyGradientPatch(d: Design, p: GradientPatch): Design {
  let g = gradientLayerOf(d);
  if (!g) return d;
  if (p.preset) {
    d = applyGradientPreset(d, p.preset);
    g = gradientLayerOf(d)!;
  }
  let fills: Fill[] = JSON.parse(JSON.stringify(g.fills));
  const needsLinear = p.angle !== undefined || p.start || p.end || p.position !== undefined || p.stops || p.startAlpha !== undefined || p.endAlpha !== undefined || p.blend;
  let idx = fills.findIndex((f) => f.kind === 'linear');
  if (needsLinear && idx < 0) {
    // image-field presets (Arnifi Light) have no editable stops: add a linear fill on top
    fills.push({ kind: 'linear', name: 'custom', angle: 90, blend: 'normal', opacity: 1,
      stops: [{ color: '#080808', alpha: 0.7, pos: 0 }, { color: '#080808', alpha: 0, pos: 70 }] });
    idx = fills.length - 1;
  }
  if (idx >= 0 && needsLinear) {
    const f = fills[idx] as LinearFill;
    if (p.angle !== undefined) f.angle = p.angle;
    if (p.blend) f.blend = p.blend;
    if (p.stops?.length) f.stops = p.stops;
    const first = f.stops[0];
    const last = f.stops[f.stops.length - 1];
    if (p.start && first) { const c = parseColor(p.start); if (c) { first.color = c.color; first.alpha = p.startAlpha ?? (c.alpha === 0 ? 0 : first.alpha || 1); } }
    if (p.end && last) { const c = parseColor(p.end); if (c) { last.color = c.color; last.alpha = p.endAlpha ?? (c.alpha === 0 ? 0 : last.alpha || 1); } }
    if (p.startAlpha !== undefined && first) first.alpha = p.startAlpha;
    if (p.endAlpha !== undefined && last) last.alpha = p.endAlpha;
    if (p.position !== undefined && f.stops.length >= 2) {
      // move the fade's end point: the last stop sits at `position`%, inner stops keep proportion
      const end = clamp(p.position, 5, 100);
      const from = f.stops[0].pos;
      const span = (last.pos - from) || 1;
      f.stops = f.stops.map((s, i) => (i === 0 ? s : { ...s, pos: +(from + ((s.pos - from) / span) * (end - from)).toFixed(2) }));
    }
  }
  if (p.darken) {
    fills = fills.map((f) => (f.kind === 'linear' || f.kind === 'radial' ? { ...f, stops: f.stops.map((s) => darkenStop(s, p.darken!)) } : f.kind === 'image' && f.blend !== 'color' ? { ...f, opacity: +clamp(f.opacity * (1 + p.darken!), 0, 1).toFixed(3) } : f));
  }
  const patch: Partial<GradientLayer> = { fills, visible: true };
  if (p.opacity !== undefined) patch.opacity = clamp(p.opacity, 0, 1);
  if (p.preset === undefined && (needsLinear || p.darken)) patch.preset = g.preset.endsWith('(edited)') ? g.preset : `${g.preset} (edited)`;
  return updateLayer(d, g.id, patch);
}

export function toggleLayer(d: Design, layerId: string, visible: boolean): Design {
  return getLayer(d, layerId) ? updateLayer(d, layerId, { visible }) : d;
}

export function replaceBackground(d: Design, assetId: string | null, source: BackgroundSource, keepFraming = false): Design {
  const bg = d.layers.find((l) => l.type === 'background') as BackgroundLayer | undefined;
  if (!bg) return d;
  const patch: Partial<BackgroundLayer> = { assetId, source, visible: true };
  if (!keepFraming) Object.assign(patch, { focalX: 0.5, focalY: 0.42, zoom: 1, offsetX: 0, offsetY: 0, flipX: false, flipY: false });
  return updateLayer(d, bg.id, patch);
}

/** Apply another recipe's look while keeping this card's content (PRD §39 Apply Template). */
export function applyTemplate(current: Design, recipeBase: Design): Design {
  const keep = (id: string) => current.layers.find((l) => l.id === id);
  const layers: Layer[] = recipeBase.layers.map((l) => {
    const cur = keep(l.id);
    if (!cur || cur.type !== l.type) return l;
    if (l.type === 'background') {
      const c = cur as BackgroundLayer;
      return { ...l, assetId: c.assetId, source: c.source, focalX: c.focalX, focalY: c.focalY, zoom: c.zoom, offsetX: c.offsetX, offsetY: c.offsetY, flipX: c.flipX, flipY: c.flipY };
    }
    if (l.type === 'text') {
      const c = cur as TextLayer;
      return { ...l, text: c.text, provenance: c.provenance, suffix: c.suffix ?? null };
    }
    return l;
  });
  return { canvas: { ...recipeBase.canvas }, layers };
}

/** The legacy focal points for repeated photos (render.py assign_focus). */
export const REPEAT_FOCUS: [number, number][] = [[0.5, 0.42], [0.32, 0.46], [0.68, 0.38], [0.46, 0.3], [0.58, 0.55], [0.24, 0.34], [0.76, 0.5]];

export function setFocusVariant(d: Design, n: number): Design {
  const bg = d.layers.find((l) => l.type === 'background') as BackgroundLayer | undefined;
  if (!bg) return d;
  const [fx, fy] = REPEAT_FOCUS[n % REPEAT_FOCUS.length];
  return updateLayer(d, bg.id, { focalX: fx, focalY: fy } as Partial<BackgroundLayer>);
}

export function setText(d: Design, layerId: 'headline' | 'subheading', text: string, provenance: TextLayer['provenance']): Design {
  return getLayer(d, layerId) ? updateLayer(d, layerId, { text, provenance } as Partial<TextLayer>) : d;
}
