/**
 * Layout warnings from measured boxes (PRD §24, §94, §48). The boxes come from the live editor
 * DOM or from the export page — the same CardScene, so the warnings agree.
 */
import type { CardWarning, Design, TextLayer } from '@acs/types';

export interface Box { x: number; y: number; w: number; h: number; lines?: number }

export function intersects(a: Box, b: Box, pad = 0) {
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
}

/** The smallest headline/subheading the auto-fit will go to (scaled from the 1600-wide card). */
export function minReadable(d: Design, role: TextLayer['role']) {
  const s = Math.min(d.canvas.width / 1600, d.canvas.height / 1000);
  return Math.round((role === 'headline' ? 34 : role === 'subheading' ? 12 : 12) * s);
}

export function layoutWarnings(d: Design, boxes: Record<string, Box>): CardWarning[] {
  const out: CardWarning[] = [];
  const { width: W, height: H } = d.canvas;
  const margin = d.canvas.safeMargin ?? Math.round(64 * Math.min(W / 1600, H / 1000));
  for (const l of d.layers) {
    if (!l.visible) continue;
    const b = boxes[l.id];
    if (l.type === 'text') {
      const label = l.role === 'headline' ? 'Headline' : l.role === 'subheading' ? 'Subheading' : 'Text';
      if (!l.text.trim()) {
        if (l.role === 'headline') out.push({ code: 'missing_heading', severity: 'warning', message: 'The heading is switched on but empty.' });
        if (l.role === 'subheading') out.push({ code: 'missing_subheading', severity: 'warning', message: 'The subheading is switched on but empty.' });
        continue;
      }
      if (!b) continue;
      const over = (b.lines ?? 1) > l.maxLines;
      const outside = b.x < -1 || b.y < -1 || b.x + b.w > W + 1 || b.y + b.h > H + 1;
      if (over || outside) {
        out.push({
          code: l.role === 'subheading' ? 'subheading_overflow' : 'headline_overflow',
          severity: 'warning',
          message: over ? `${label} runs to ${b.lines} lines (max ${l.maxLines}).` : `${label} runs outside the canvas.`,
        });
      }
    }
    if (l.type === 'logo' && b) {
      const edge = Math.min(b.x, b.y, W - (b.x + b.w), H - (b.y + b.h));
      if (edge < Math.max(8, margin * 0.35)) {
        out.push({ code: 'logo_edge', severity: 'warning', message: 'Logo is too close to the edge.' });
      }
      for (const t of d.layers) {
        if (t.type !== 'text' || !t.visible || !t.text.trim()) continue;
        const tb = boxes[t.id];
        if (tb && intersects(b, tb, 4)) {
          out.push({ code: 'logo_conflict', severity: 'warning', message: `Logo overlaps the ${t.role === 'subheading' ? 'subheading' : 'heading'}.` });
        }
      }
    }
  }
  return out;
}
