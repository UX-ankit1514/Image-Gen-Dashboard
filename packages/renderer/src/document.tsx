/**
 * The export page: the same CardScene the editor shows, as a standalone HTML document for
 * headless Chrome. Server-only (react-dom/server), so it is a separate entry point.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { Design } from '@acs/types';
import { CardScene, type SrcResolver } from './CardScene';

export interface DocumentOptions {
  resolveSrc: SrcResolver;
  /** @font-face rules with absolute URLs (see fontCss). */
  fontCss: string;
}

/** Rewrites fonts-local.css's relative `url(fonts/…)` to an absolute base (file:// or https://). */
export function fontCss(css: string, base: string) {
  const b = base.replace(/\/$/, '');
  return css.replace(/url\((['"]?)fonts\//g, (_m, q) => `url(${q}${b}/fonts/`);
}

export function renderCardHtml(design: Design, opts: DocumentOptions) {
  const body = renderToStaticMarkup(<CardScene design={design} resolveSrc={opts.resolveSrc} />);
  const { width, height, background } = design.canvas;
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<style>${opts.fontCss}\n*{margin:0;padding:0;box-sizing:border-box}` +
    `html,body{width:${width}px;height:${height}px;overflow:hidden;background:${background}}</style>` +
    `</head><body>${body}</body></html>`
  );
}

/** Puppeteer-side readiness check: fonts loaded and every image decoded. Returns layout metrics. */
export const READY_SCRIPT = `(async () => {
  await document.fonts.ready;
  const imgs = Array.from(document.images);
  await Promise.all(imgs.map((i) => i.complete && i.naturalWidth ? (i.decode ? i.decode().catch(() => {}) : null)
    : new Promise((r) => { i.onload = i.onerror = r; })));
  return { images: imgs.length, broken: imgs.filter((i) => !i.naturalWidth).map((i) => i.src.slice(0, 120)) };
})()`;

/** Measures every text layer's box and line count, in canvas px, for the layout warnings. */
export const MEASURE_SCRIPT = `(() => {
  const root = document.querySelector('[data-card-root]');
  const r0 = root.getBoundingClientRect();
  const out = {};
  root.querySelectorAll('[data-layer-id]').forEach((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el.tagName === 'DIV' && el.style.display === 'flex' ? el.lastElementChild : el);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    const textEl = el.style.display === 'flex' ? el.lastElementChild : el;
    const tr = textEl.getBoundingClientRect();
    out[el.getAttribute('data-layer-id')] = {
      x: r.left - r0.left, y: r.top - r0.top, w: r.width, h: r.height,
      lines: Math.max(1, Math.round(tr.height / lh)),
    };
  });
  return out;
})()`;
