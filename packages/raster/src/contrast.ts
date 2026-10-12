/**
 * WCAG contrast of text against the photo behind it, measured on the rendered card
 * (relight.py key_line_contrast): text pixels are excluded so only the background is measured.
 */
const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

export function hexLuminance(hex: string) {
  const h = hex.replace('#', '');
  return lum(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16));
}

export interface Region { x: number; y: number; w: number; h: number }

/** 60th-percentile background luminance in a region, ignoring pixels brighter than `textCut`. */
function backgroundLum(rgb: Uint8Array, width: number, height: number, r: Region, textCut: number) {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(width, Math.ceil(r.x + r.w));
  const y1 = Math.min(height, Math.ceil(r.y + r.h));
  const vals: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 3;
      const L = lum(rgb[i], rgb[i + 1], rgb[i + 2]);
      if (L < textCut) vals.push(L);
    }
  }
  if (!vals.length) return 0;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length * 0.6)];
}

export function textContrast(rgb: Uint8Array, width: number, height: number, region: Region, textHex: string) {
  const bg = backgroundLum(rgb, width, height, region, lin(205));
  const key = hexLuminance(textHex);
  const [hi, lo] = key > bg ? [key, bg] : [bg, key];
  return (hi + 0.05) / (lo + 0.05);
}

/** The legacy region: rows 720–960, columns 60–1000 of a 1600×1000 card, scaled to the canvas. */
export function legacyKeyLineRegion(width: number, height: number): Region {
  const sx = width / 1600;
  const sy = height / 1000;
  return { x: 60 * sx, y: 720 * sy, w: 940 * sx, h: 240 * sy };
}
