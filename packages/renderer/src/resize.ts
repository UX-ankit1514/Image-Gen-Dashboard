/**
 * Canvas resizing (PRD §27–28). Every mode returns a new design; the caller stores it as a new
 * version, so the previous size is never destroyed.
 *
 *  scale  — positions stay relative (x·sx, y·sy); logo, text, margins scale by s = min(sx, sy)
 *  keep   — positions stay relative, element sizes are untouched
 *  reflow — the template's edge anchoring is re-applied: margins and sizes scale by s from the
 *           edge each element hugs (logo top-left, text block bottom-left)
 */
import type { Design, Layer, TextLayer } from '@acs/types';

export type ResizeMode = 'scale' | 'keep' | 'reflow';

const near = (a: number, b: number, tol = 1.5) => Math.abs(a - b) <= tol;
const round = (v: number) => Math.round(v * 100) / 100;

function scaleText(l: TextLayer, s: number): Partial<TextLayer> {
  return {
    fontSize: round(l.fontSize * s),
    autoSize: l.autoSize ? { steps: l.autoSize.steps.map((st) => ({ max: st.max, size: round(st.size * s) })) } : null,
    shadows: l.shadows.map((sh) => ({ ...sh, x: round(sh.x * s), y: round(sh.y * s), blur: round(sh.blur * s) })),
    stackGap: round(l.stackGap * s),
    lead: l.lead ? { ...l.lead, width: round(l.lead.width * s), height: Math.max(1, round(l.lead.height * s)), gap: round(l.lead.gap * s) } : null,
    rule: l.rule ? { ...l.rule, width: round(l.rule.width * s), height: Math.max(1, round(l.rule.height * s)),
      gap: round(l.rule.gap * s), radius: round(l.rule.radius * s) } : null,
  };
}

export function resizeDesign(d: Design, W2: number, H2: number, mode: ResizeMode, fit: 'cover' | 'contain' = 'cover'): Design {
  const { width: W, height: H } = d.canvas;
  const sx = W2 / W;
  const sy = H2 / H;
  const s = Math.min(sx, sy);

  const layers = d.layers.map((l): Layer => {
    const full = near(l.x, 0) && near(l.y, 0) && near(l.width, W) && near(l.height, H);
    if (full) {
      const base = { ...l, x: 0, y: 0, width: W2, height: H2 } as Layer;
      return base.type === 'background' ? { ...base, fit } : base;
    }

    let x: number, y: number, width: number, height: number;
    const sizeScale = mode === 'keep' ? 1 : s;
    if (mode === 'reflow') {
      const spansWidth = l.width > W * 0.5;
      const leftAnchored = l.x + l.width / 2 <= W / 2;
      const bottomAnchored = l.type === 'text' ? l.anchorY === 'bottom' : l.y + l.height / 2 > H / 2;
      if (spansWidth) {
        const ml = l.x * s;
        const mr = (W - l.x - l.width) * s;
        x = ml;
        width = Math.max(40, W2 - ml - mr);
      } else {
        width = l.width * s;
        x = leftAnchored ? l.x * s : W2 - (W - l.x) * s;
      }
      height = l.height * s;
      if (l.type === 'text') {
        y = l.anchorY === 'bottom' ? H2 - (H - l.y) * s : l.y * s;
      } else {
        y = bottomAnchored ? H2 - (H - l.y) * s : l.y * s;
      }
    } else {
      x = l.x * sx;
      y = l.y * sy;
      width = l.type === 'text' ? l.width * sx : l.width * sizeScale;
      height = l.height * sizeScale;
      if (mode === 'keep' && l.type === 'text') width = Math.min(l.width, W2 - x);
    }

    const out = { ...l, x: round(x), y: round(y), width: round(width), height: round(height) } as Layer;
    if (out.type === 'text' && mode !== 'keep') Object.assign(out, scaleText(l as TextLayer, s));
    if (out.type === 'logo' && out.shadow && mode !== 'keep') {
      out.shadow = { ...out.shadow, y: round(out.shadow.y * s), blur: round(out.shadow.blur * s) };
    }
    // nothing may end up wholly outside the frame
    out.x = Math.min(Math.max(out.x, -out.width + 8), W2 - 8);
    if (out.type !== 'text' || out.anchorY === 'top') out.y = Math.min(Math.max(out.y, -out.height + 8), H2 - 8);
    else out.y = Math.min(Math.max(out.y, 8), H2);
    return out;
  });

  return {
    canvas: { ...d.canvas, width: Math.round(W2), height: Math.round(H2),
      safeMargin: d.canvas.safeMargin != null ? round(d.canvas.safeMargin * s) : undefined },
    layers,
  };
}
