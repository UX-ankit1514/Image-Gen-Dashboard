/**
 * Design JSON → pixels, the way the legacy pipeline did it: one headless Chrome page per card at
 * device scale 2, then a Lanczos downsample (legacy: Pillow LANCZOS; here: sharp lanczos3) and the
 * legacy JPEG settings (quality 91, 4:4:4, progressive). Node only.
 *
 * The page is written to a temp file and opened with file:// (as render.py did) so file:// assets
 * load; https:// asset URLs work the same way.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer, { type Browser } from 'puppeteer-core';
import sharp from 'sharp';
import type { Design } from '@acs/types';
import { MEASURE_SCRIPT, READY_SCRIPT, renderCardHtml } from '@acs/renderer/document';
import type { SrcResolver, Box } from '@acs/renderer';
import { pillowLanczos } from './lanczos';

export { pillowLanczos };

export type Format = 'png' | 'jpg' | 'webp';

export interface RasterOptions {
  resolveSrc: SrcResolver;
  fontCss: string;
  /** Output scale relative to the canvas size: 1 = 1600×1000 for a 1600×1000 design. */
  scale?: number;
  format?: Format;
  quality?: number;
  /** Supersampling factor for the screenshot (legacy: 2). Capped so 4× exports stay sane. */
  supersample?: number;
}

export interface RasterResult {
  buffer: Buffer;
  width: number;
  height: number;
  mime: string;
  boxes: Record<string, Box>;
  broken: string[];
}

export interface RasterizerConfig {
  executablePath: string;
  args?: string[];
  headless?: boolean | 'shell';
}

export const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export class Rasterizer {
  /** One Chrome per (device scale, window size). The scale is set with the real
   *  --force-device-scale-factor flag, as render.py did: puppeteer's emulated deviceScaleFactor lays
   *  text out ~1px differently and failed parity. */
  private browsers = new Map<string, Promise<Browser>>();
  private dir = mkdtempSync(join(tmpdir(), 'acs-raster-'));
  private seq = 0;

  constructor(private cfg: RasterizerConfig) {}

  private launch(dsf: number, W: number, H: number) {
    const key = `${dsf}:${W}x${H}`;
    let b = this.browsers.get(key);
    if (!b) {
      while (this.browsers.size >= 3) {
        const [k, old] = this.browsers.entries().next().value as [string, Promise<Browser>];
        this.browsers.delete(k);
        old.then((x) => x.close()).catch(() => {});
      }
      b = puppeteer.launch({
        executablePath: this.cfg.executablePath,
        headless: this.cfg.headless ?? true,
        defaultViewport: null,
        args: ['--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
          `--force-device-scale-factor=${dsf}`, `--window-size=${W},${H}`, ...(this.cfg.args ?? [])],
      });
      this.browsers.set(key, b);
    }
    return b;
  }

  /** The supersampled screenshot (PNG) plus measured layer boxes, before any downsampling. */
  async capture(design: Design, opts: RasterOptions) {
    const { width: W, height: H } = design.canvas;
    const scale = opts.scale ?? 1;
    // legacy: 2× for a 1× card. Larger exports supersample less so the capture stays ≤ ~40 MP.
    const maxDsf = Math.max(1, Math.floor(Math.min(16000 / Math.max(W, H), Math.sqrt(40e6 / (W * H)))));
    const dsf = Math.max(Math.min(Math.ceil(scale * (opts.supersample ?? 2)), maxDsf), Math.min(Math.ceil(scale), maxDsf));
    const browser = await this.launch(dsf, W, H);
    const page = await browser.newPage();
    const file = join(this.dir, `card-${process.pid}-${++this.seq}.html`);
    try {
      writeFileSync(file, renderCardHtml(design, { resolveSrc: opts.resolveSrc, fontCss: opts.fontCss }));
      await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 90_000 });
      const ready = (await page.evaluate(READY_SCRIPT)) as { broken: string[] };
      const boxes = (await page.evaluate(MEASURE_SCRIPT)) as Record<string, Box>;
      const png = (await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } })) as Uint8Array;
      return { png: Buffer.from(png), dsf, boxes, broken: ready.broken };
    } finally {
      await page.close().catch(() => {});
      rmSync(file, { force: true });
    }
  }

  async render(design: Design, opts: RasterOptions): Promise<RasterResult> {
    const { width: W, height: H } = design.canvas;
    const scale = opts.scale ?? 1;
    const outW = Math.max(1, Math.round(W * scale));
    const outH = Math.max(1, Math.round(H * scale));
    const shot = await this.capture(design, opts);
    const raw = await sharp(shot.png, { limitInputPixels: false }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixels = raw.info.width === outW && raw.info.height === outH
      ? raw.data
      : Buffer.from(pillowLanczos(raw.data, raw.info.width, raw.info.height, 3, outW, outH));
    const img = sharp(pixels, { raw: { width: outW, height: outH, channels: 3 } });
    const format = opts.format ?? 'jpg';
    let buffer: Buffer;
    if (format === 'jpg') {
      buffer = await img.jpeg({ quality: opts.quality ?? 91, chromaSubsampling: '4:4:4', progressive: true, optimiseCoding: true, mozjpeg: false }).toBuffer();
    } else if (format === 'webp') {
      buffer = await img.webp({ quality: opts.quality ?? 92, effort: 4 }).toBuffer();
    } else {
      buffer = await img.png({ compressionLevel: 8 }).toBuffer();
    }
    return { buffer, width: outW, height: outH, mime: format === 'jpg' ? 'image/jpeg' : `image/${format}`, boxes: shot.boxes, broken: shot.broken };
  }

  async close() {
    const all = [...this.browsers.values()];
    this.browsers.clear();
    await Promise.all(all.map((b) => b.then((x) => x.close()).catch(() => {})));
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/** Mean absolute difference per channel, 0..255, plus a heat map (|diff|·8) for inspection. */
export async function diffImages(a: Buffer, b: Buffer, heatmapPath?: string) {
  const A = await sharp(a).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const Bm = sharp(b).removeAlpha();
  const B = await Bm.resize(A.info.width, A.info.height, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const n = A.data.length;
  let sum = 0;
  let max = 0;
  const heat = heatmapPath ? Buffer.alloc(A.info.width * A.info.height) : null;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i += 3) {
    const d = (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2])) / 3;
    sum += d;
    if (d > max) max = d;
    hist[Math.min(255, Math.round(d))]++;
    if (heat) heat[i / 3] = Math.min(255, Math.round(d * 8));
  }
  const px = n / 3;
  let acc = 0;
  let p99 = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= px * 0.99) { p99 = v; break; } }
  if (heat && heatmapPath) {
    await sharp(heat, { raw: { width: A.info.width, height: A.info.height, channels: 1 } }).png().toFile(heatmapPath);
  }
  return { mean: sum / px, max, p99 };
}
export * from './contrast';
