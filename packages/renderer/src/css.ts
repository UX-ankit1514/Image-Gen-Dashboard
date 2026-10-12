/** Design JSON → CSS values. One place, so the editor and the export cannot drift apart. */
import type { BackgroundLayer, Fill, Mask, Shadow, Stop } from '@acs/types';

export function stopColor(s: Stop) {
  const h = s.color.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${+s.alpha.toFixed(4)})`;
}

export function stopsCss(stops: Stop[]) {
  return stops.map((s) => `${stopColor(s)} ${+s.pos.toFixed(3)}%`).join(',');
}

export function maskCss(m: Mask) {
  return `linear-gradient(${m.angle}deg,${stopsCss(m.stops)})`;
}

/** The `background` value for a gradient fill; image fills render as <img>, not here. */
export function fillBackground(f: Fill): string | null {
  switch (f.kind) {
    case 'linear':
      return `linear-gradient(${f.angle}deg,${stopsCss(f.stops)})`;
    case 'radial':
      return `radial-gradient(${f.rx}% ${f.ry}% at ${f.cx}% ${f.cy}%,${stopsCss(f.stops)})`;
    default:
      return null;
  }
}

export function shadowsCss(shadows: Shadow[]) {
  return shadows.length ? shadows.map((s) => `${s.x}px ${s.y}px ${s.blur}px ${s.color}`).join(',') : undefined;
}

/** Fixed order saturate → contrast → brightness, matching both legacy stylesheets; identity
 *  terms are dropped so "saturate(1.08) contrast(1.10)" stays exactly that. */
export function photoFilter(a: BackgroundLayer['adjust']) {
  const parts: string[] = [];
  if (a.saturate !== 1) parts.push(`saturate(${a.saturate})`);
  if (a.contrast !== 1) parts.push(`contrast(${a.contrast})`);
  if (a.brightness !== 1) parts.push(`brightness(${a.brightness})`);
  return parts.length ? parts.join(' ') : undefined;
}

export const FONT_STACKS: Record<string, string> = {
  Lora: 'Lora, serif',
  Inter: 'Inter, sans-serif',
  serif: 'serif',
  'sans-serif': 'sans-serif',
  Georgia: 'Georgia, serif',
  'Helvetica Neue': '"Helvetica Neue", Helvetica, Arial, sans-serif',
};

export function fontStack(name: string) {
  return FONT_STACKS[name] ?? `"${name.replace(/"/g, '')}", sans-serif`;
}

export const OBJECT_FIT: Record<BackgroundLayer['fit'], 'cover' | 'contain' | 'fill' | 'none'> = {
  cover: 'cover', contain: 'contain', fill: 'fill', original: 'none',
};

export function pct(v: number) {
  return `${+(v * 100).toFixed(3)}%`;
}
