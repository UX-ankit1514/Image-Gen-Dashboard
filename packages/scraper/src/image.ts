/**
 * Image ingestion helpers (PRD §15, §47, §53): normalise, make variants, hash, and the cheap local
 * signals the asset flags come from. Node only (sharp).
 */
import sharp from 'sharp';

export const HUGE_PIXELS = 60_000_000;     // legacy scrape.py: banners over this get resampled
export const LONG_EDGE = 4000;
export const LOW_RES_MIN_SIDE = 700;       // legacy audit.py low_res

export interface Analysed {
  /** The stored "original": the file as fetched, unless it was huge (then a 4000 px PNG/JPEG). */
  original: Buffer;
  mime: string;
  ext: string;
  width: number;
  height: number;
  resampledFrom: { width: number; height: number } | null;
  thumb: Buffer;      // 480 px wide WebP — the only thing grids load (PRD §76)
  preview: Buffer;    // ≤ 2000 px long edge WebP — what the editor shows
  dhash: string;
  inkScore: number;
  hasAlpha: boolean;
}

/** 64-bit difference hash, hex. Near-duplicates differ in ≤ 6 bits. */
export async function dhash(input: Buffer) {
  const img = sharp(input, { limitInputPixels: false });
  const { data } = await img.flatten({ background: '#808080' }).greyscale().resize(9, 8, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += data[y * 9 + x] > data[y * 9 + x + 1] ? '1' : '0';
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/**
 * legacy phototext.ink(): the fraction of the frame that looks like printed matter (dark strokes in
 * a bright field). A hint for "possible text" only — the README records it misjudging real cases.
 */
export async function inkScore(buf: Buffer) {
  const base = sharp(buf, { limitInputPixels: false }).flatten({ background: '#ffffff' }).resize(900, 900, { fit: 'inside', kernel: 'lanczos3' }).greyscale();
  const grey = await base.clone().raw().toBuffer({ resolveWithObject: true });
  const bg = await base.clone().blur(28).raw().toBuffer();
  const { width: w, height: h } = grey.info;
  let hits = 0;
  let n = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = y * w + x;
      n++;
      if (bg[i] > 120 && grey.data[i] < bg[i] - 35) hits++;
    }
  }
  return n ? hits / n : 0;
}

export async function analyse(bytes: Uint8Array, kind: 'png' | 'jpeg' | 'webp' | 'gif' | 'avif'): Promise<Analysed> {
  const input = Buffer.from(bytes);
  const meta = await sharp(input, { limitInputPixels: false, failOn: 'error' }).metadata();
  let width = meta.width ?? 0;
  let height = meta.height ?? 0;
  if (!width || !height) throw new Error('unsupported image: no dimensions');
  let original = input;
  let mime = kind === 'jpeg' ? 'image/jpeg' : `image/${kind}`;
  let ext = kind === 'jpeg' ? 'jpg' : kind;
  let resampledFrom: Analysed['resampledFrom'] = null;
  const hasAlpha = !!meta.hasAlpha;

  if (width * height > HUGE_PIXELS || kind === 'gif' || kind === 'avif') {
    // keep the working copy sane (21328 px will-drafting banners) and in a format Chrome and sharp both read
    const s = sharp(input, { limitInputPixels: false }).rotate();
    const big = width * height > HUGE_PIXELS;
    const pipeline = big ? s.resize(LONG_EDGE, LONG_EDGE, { fit: 'inside', kernel: 'lanczos3' }) : s;
    original = hasAlpha ? await pipeline.png().toBuffer() : await pipeline.jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer();
    mime = hasAlpha ? 'image/png' : 'image/jpeg';
    ext = hasAlpha ? 'png' : 'jpg';
    if (big) resampledFrom = { width, height };
    const m2 = await sharp(original).metadata();
    width = m2.width!;
    height = m2.height!;
  }

  const src = sharp(original, { limitInputPixels: false }).rotate();
  const [thumb, preview, dh, ink] = await Promise.all([
    src.clone().resize(480, null, { withoutEnlargement: true }).webp({ quality: 80 }).toBuffer(),
    src.clone().resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 88 }).toBuffer(),
    dhash(original),
    inkScore(original),
  ]);
  return { original, mime, ext, width, height, resampledFrom, thumb, preview, dhash: dh, inkScore: Math.round(ink * 10000) / 10000, hasAlpha };
}

/** The local flags; containsText / containsLogo stay null until AI vision looks (PRD §15). */
export function flagsFor(a: { width: number; height: number; inkScore: number }, canvas = { width: 1600, height: 1000 }) {
  const ar = a.width / a.height;
  const target = canvas.width / canvas.height;
  return {
    lowRes: Math.min(a.width, a.height) < LOW_RES_MIN_SIDE || a.width < canvas.width * 0.6,
    possibleText: a.inkScore >= 0.015,
    aspectMismatch: Math.abs(ar - target) / target > 0.35,
    containsText: null,
    containsLogo: null,
  };
}
