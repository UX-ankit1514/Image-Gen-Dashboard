/**
 * How arnifi.com shows a card image in its listing grids, measured from the live pages' computed
 * styles (13 Oct 2026). Every listing draws the image with object-fit: cover, centred:
 *
 *   Business setup  /product-listing?…productType=licence
 *     box aspect-ratio 16/10 at the card's width; on hover (≥900px) the card body slides up 60px.
 *   Visa services   /services/visa-service
 *     box 141px tall at the card's width; the card body sits at top:120px (≥900px), so it already
 *     covers the bottom 21px, and moves to top:57px on hover.
 *   Post-setup      /services/post-setup-compliance
 *     the same 141px box, with the card body below it: nothing covers the image.
 *
 * Card widths follow each layout's MUI grid: three columns from 900px, one below, inside the
 * page gutters (business: 60px margins, 80% column, 30px inset; services: 40px, 80%, 40px).
 */

export type ListingId = 'licence' | 'visa' | 'postsetup';
export type DeviceId = 'wide' | 'desktop' | 'laptop' | 'tablet' | 'phone';

export interface Device { id: DeviceId; label: string; vw: number }

export const DEVICES: Device[] = [
  { id: 'wide', label: 'Large desktop · 1920', vw: 1920 },
  { id: 'desktop', label: 'Desktop · 1440', vw: 1440 },
  { id: 'laptop', label: 'Laptop · 1280', vw: 1280 },
  { id: 'tablet', label: 'Tablet · 768', vw: 768 },
  { id: 'phone', label: 'Phone · 390', vw: 390 },
];

export interface ListingSpec {
  id: ListingId;
  label: string;
  page: string;
  url: string;
  layout: 'business' | 'services';
  /** Box aspect ratio (w/h), or null when the box has a fixed height. */
  ratio: number | null;
  height: number | null;
  /** CSS px at the bottom of the box hidden under the card body, at rest and on hover. */
  cover: (vw: number) => { rest: number; hover: number };
  /** The country badge in the box's top-right corner, CSS px. */
  badge: { w: number; h: number };
}

export const LISTINGS: ListingSpec[] = [
  {
    id: 'licence', label: 'Business setup', page: 'Business Setup Packages & Licenses',
    url: 'arnifi.com/product-listing?countries=1&productType=licence', layout: 'business', ratio: 1.6, height: null,
    cover: (vw) => ({ rest: 0, hover: vw >= 900 ? 60 : 0 }), badge: { w: 62, h: 28 },
  },
  {
    id: 'visa', label: 'Visa services', page: 'Visa Services', url: 'arnifi.com/services/visa-service',
    layout: 'services', ratio: null, height: 141,
    cover: (vw) => (vw >= 900 ? { rest: 21, hover: 84 } : { rest: 0, hover: 0 }), badge: { w: 76, h: 32 },
  },
  {
    id: 'postsetup', label: 'Post-setup compliance', page: 'Post-Setup Compliance', url: 'arnifi.com/services/post-setup-compliance',
    layout: 'services', ratio: null, height: 141, cover: () => ({ rest: 0, hover: 0 }), badge: { w: 62, h: 28 },
  },
];

export const listingById = (id: string) => LISTINGS.find((l) => l.id === id) ?? LISTINGS[0];
export const deviceById = (id: string) => DEVICES.find((d) => d.id === id) ?? DEVICES[1];

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The card's outer width (with its 1px border) in a layout at a viewport width. */
export function cardWidth(layout: ListingSpec['layout'], vw: number) {
  if (vw < 900) return vw - 48;
  if (layout === 'business') return vw >= 1200 ? (0.8 * (vw - 120) - 30 + 16) / 3 - 16 : (vw - 48 + 16) / 3 - 16;
  return vw >= 1200 ? (0.8 * (vw - 80) - 40 + 16) / 3 - 16 : (vw - 128 + 16) / 3 - 16;
}

/** The image box, CSS px. */
export function imageBox(spec: ListingSpec, vw: number) {
  const w = r2(cardWidth(spec.layout, vw) - 2);
  return { w, h: spec.ratio ? r2(w / spec.ratio) : spec.height! };
}

export interface Rect { x: number; y: number; w: number; h: number }
export interface Size { width: number; height: number }

export interface Placement {
  box: { w: number; h: number };
  /** CSS px per source px. */
  scale: number;
  /** The part of the source inside the box. */
  shown: Rect;
  /** `shown` minus what the card body covers at rest. */
  rest: Rect;
  /** What stays visible on hover, when hovering changes anything. */
  hover: Rect | null;
  /** Fractions of the source the crop removes from each side. */
  cut: { top: number; bottom: number; left: number; right: number };
  cover: { rest: number; hover: number };
  /** Source px per CSS px: 2 or more stays sharp on retina screens. */
  density: number;
  /** The source area under the country badge. */
  badge: Rect;
}

export function place(spec: ListingSpec, vw: number, src: Size): Placement {
  const box = imageBox(spec, vw);
  const scale = Math.max(box.w / src.width, box.h / src.height);
  const sw = box.w / scale;
  const sh = box.h / scale;
  const shown = { x: (src.width - sw) / 2, y: (src.height - sh) / 2, w: sw, h: sh };
  const cover = spec.cover(vw);
  const rest = { ...shown, h: sh - cover.rest / scale };
  const hover = cover.hover !== cover.rest ? { ...shown, h: sh - cover.hover / scale } : null;
  const cutX = shown.x / src.width;
  const cutY = shown.y / src.height;
  const badge = { x: shown.x + sw - spec.badge.w / scale, y: shown.y, w: spec.badge.w / scale, h: spec.badge.h / scale };
  return { box, scale, shown, rest, hover, cut: { top: cutY, bottom: cutY, left: cutX, right: cutX }, cover, density: 1 / scale, badge };
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** The area that stays visible at rest on every screen size (and, with `hover`, also on hover). */
export function safeArea(spec: ListingSpec, src: Size, hover = false): Rect {
  let safe: Rect = { x: 0, y: 0, w: src.width, h: src.height };
  for (const d of DEVICES) {
    const p = place(spec, d.vw, src);
    safe = intersect(safe, hover && p.hover ? p.hover : p.rest) ?? { x: safe.x, y: safe.y, w: 0, h: 0 };
  }
  return safe;
}

const NAMED: [number, number][] = [[16, 10], [16, 9], [4, 3], [3, 2], [1, 1], [4, 5], [5, 4], [3, 4], [2, 3], [9, 16], [2, 1], [21, 9]];

export function ratioLabel(r: number) {
  for (const [a, b] of NAMED) if (Math.abs(r - a / b) / (a / b) < 0.012) return `${a}:${b}`;
  return r >= 1 ? `${+r.toFixed(2)}:1` : `1:${+(1 / r).toFixed(2)}`;
}

const pc = (v: number) => `${Math.round(v * 100)}%`;
const px = (v: number) => `${Math.round(v)}`;

export type Visibility = 'visible' | 'cut' | 'hidden';
export interface LayerBox { id: string; label: string; rect: Rect; important?: boolean }

export function visibility(rect: Rect, area: Rect): Visibility {
  const hit = intersect(rect, area);
  const f = hit ? (hit.w * hit.h) / Math.max(1, rect.w * rect.h) : 0;
  return f >= 0.98 ? 'visible' : f <= 0.02 ? 'hidden' : 'cut';
}

export type Verdict = 'good' | 'warn' | 'bad';

export interface Assessment {
  verdict: Verdict;
  title: string;
  facts: { label: string; value: string; tone?: 'ok' | 'warn' | 'err' }[];
  layers: { id: string; label: string; rect: Rect; rest: Visibility; hover: Visibility | null; underBadge: boolean; important: boolean }[];
  tips: string[];
}

/** "the logo", "the key line": layer labels inside a sentence. */
const the = (label: string) => `the ${label.toLowerCase()}`;

function joinLabels(xs: string[]) {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/** The size check for one listing on one screen: what shows, what's cut, and what to change. */
export function assess(spec: ListingSpec, device: Device, src: Size, layers: LayerBox[] | null): Assessment {
  const p = place(spec, device.vw, src);
  const safe = safeArea(spec, src);
  const largest = DEVICES.reduce((m, d) => {
    const b = imageBox(spec, d.vw);
    return b.w > m.w ? b : m;
  }, { w: 0, h: 0 });
  const cropY = p.cut.top + p.cut.bottom;
  const cropX = p.cut.left + p.cut.right;
  const cropped = Math.max(cropX, cropY) > 0.04;

  const ls = (layers ?? []).map((l) => ({
    id: l.id, label: l.label, rect: l.rect, important: !!l.important,
    rest: visibility(l.rect, p.rest),
    hover: p.hover ? visibility(l.rect, p.hover) : null,
    underBadge: !!intersect(l.rect, p.badge),
  }));
  const lostAtRest = ls.filter((l) => l.important && l.rest !== 'visible');
  const lostOnHover = ls.filter((l) => l.important && l.rest === 'visible' && l.hover && l.hover !== 'visible');

  const facts: Assessment['facts'] = [
    { label: 'Your image', value: `${src.width} × ${src.height} px · ${ratioLabel(src.width / src.height)}` },
    { label: 'Shown at', value: `${px(p.box.w)} × ${px(p.box.h)} px · ${ratioLabel(p.box.w / p.box.h)}` },
  ];
  facts.push(!cropped
    ? { label: 'Cropped', value: 'Nothing: the whole image shows', tone: 'ok' }
    : cropY > cropX
      ? { label: 'Cropped', value: `Top ${pc(p.cut.top)} and bottom ${pc(p.cut.bottom)} are cut off`, tone: 'warn' }
      : { label: 'Cropped', value: `Left ${pc(p.cut.left)} and right ${pc(p.cut.right)} are cut off`, tone: 'warn' });
  if (p.cover.rest) facts.push({ label: 'Card text', value: `Covers the bottom ${p.cover.rest} px of the image`, tone: 'warn' });
  if (p.cover.hover && p.cover.hover !== p.cover.rest) {
    facts.push({ label: 'On hover', value: spec.ratio ? `The card text slides over the bottom ${p.cover.hover} px` : `Only the top ${px(p.box.h - p.cover.hover)} px stays visible` });
  }
  facts.push(p.density >= 2
    ? { label: 'Sharpness', value: `Sharp on retina screens (${p.density.toFixed(1)}× the pixels needed at 1×)`, tone: 'ok' }
    : p.density >= 1
      ? { label: 'Sharpness', value: `Fine on standard screens, soft on retina: needs ${Math.ceil(src.width * (2 / p.density))} px wide`, tone: 'warn' }
      : { label: 'Sharpness', value: `Blurry: stretched ${(1 / p.density).toFixed(1)}× to fill the box`, tone: 'err' });

  const verdict: Verdict = lostAtRest.length || p.density < 1 ? 'bad'
    : cropped || lostOnHover.length || p.cover.rest || p.density < 2 ? 'warn' : 'good';

  const title = lostAtRest.length ? `${joinLabels(lostAtRest.map((l) => l.label))} cut off here`
    : p.density < 1 ? 'Too small for this box'
      : cropped ? (spec.ratio ? 'Cropped to fit' : 'Shows a cropped strip')
        : lostOnHover.length ? 'Fits; hover covers the bottom'
          : p.density < 2 ? 'Fits, but soft on retina' : 'Fits this listing';

  const tips: string[] = [];
  const band = (a: number, b: number) => `${pc(a)} and ${pc(b)}`;
  if (cropped && safe.w > 0 && safe.h > 0) {
    tips.push(cropY >= cropX
      ? `Keep anything important between ${band(safe.y / src.height, (safe.y + safe.h) / src.height)} of the height: that band shows on every screen size.`
      : `Keep anything important between ${band(safe.x / src.width, (safe.x + safe.w) / src.width)} of the width: that band shows on every screen size.`);
  }
  if (lostAtRest.length && !spec.ratio) {
    const h = Math.round(1600 / 2.4);
    tips.push(`This listing only shows a ${ratioLabel(p.box.w / p.box.h)} strip of the card, so ${joinLabels(lostAtRest.map((l) => the(l.label)))} won't appear here (the product page still shows the full card). If the listing image has to carry them, make a 1600 × ${h} banner (2.4:1) and keep them inside its middle band.`);
  } else if (lostAtRest.length) {
    tips.push(`Move ${joinLabels(lostAtRest.map((l) => the(l.label)))} inside the visible area, or use a 16:10 card (1600 × 1000) so nothing is cropped.`);
  }
  if (spec.ratio && Math.abs(src.width / src.height - spec.ratio) / spec.ratio > 0.02) {
    tips.push('This listing is 16:10. A 1600 × 1000 card fits it exactly, with nothing cropped.');
  }
  if (lostOnHover.length) {
    tips.push(`While someone points at the card, the text panel covers ${joinLabels(lostOnHover.map((l) => the(l.label)))}. Every card on this page behaves the same way, so this is normal; move it above ${pc(1 - p.cover.hover / p.box.h)} of the height if it must stay visible.`);
  }
  if (p.cover.rest && !lostAtRest.length) {
    tips.push(`The bottom ${p.cover.rest} px of the box is always under the card text on desktop: don't put detail there.`);
  }
  if (p.density < 2) {
    tips.push(`Export at least ${Math.ceil(largest.w * 2)} × ${Math.ceil(largest.h * 2)} px (twice the largest box, on a 1920 screen) so it stays sharp on retina screens.`);
  }
  const badgeHit = ls.filter((l) => l.underBadge && l.rest !== 'hidden');
  if (badgeHit.length) tips.push(`${joinLabels(badgeHit.map((l) => l.label))} touches the top-right corner, where the country badge sits.`);
  if (!tips.length) tips.push('No change needed for this listing.');

  return { verdict, title, facts, layers: ls, tips };
}
