/**
 * Pillow's Image.resize(..., Image.LANCZOS), reproduced bit for bit (Pillow src/libImaging/Resample.c):
 * separable passes, horizontal first, 8-bit fixed-point coefficients (PRECISION_BITS = 22) and an
 * 8-bit intermediate image. The legacy cards were downsampled this way; sharp's lanczos3 takes a
 * box-shrink shortcut for integer factors and lands ~0.6/255 away, which is enough to fail parity.
 */
const PRECISION_BITS = 32 - 8 - 2;
const ONE = 2 ** PRECISION_BITS;
const HALF = 2 ** (PRECISION_BITS - 1);
const MAX = 2 ** (PRECISION_BITS + 8);

function sinc(x: number) {
  if (x === 0) return 1;
  const px = x * Math.PI;
  return Math.sin(px) / px;
}

function lanczos(x: number) {
  return x > -3 && x < 3 ? sinc(x) * sinc(x / 3) : 0;
}

interface Coeffs { bounds: Int32Array; kk: Float64Array; ksize: number }

function precompute(inSize: number, outSize: number): Coeffs {
  const scale = inSize / outSize;
  const filterscale = Math.max(scale, 1);
  const support = 3 * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;
  const kk = new Float64Array(outSize * ksize);
  const bounds = new Int32Array(outSize * 2);
  const ss = 1 / filterscale;
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    let xmin = Math.trunc(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;
    let ww = 0;
    const pre = new Float64Array(xmax);
    for (let x = 0; x < xmax; x++) {
      const w = lanczos((x + xmin - center + 0.5) * ss);
      pre[x] = w;
      ww += w;
    }
    for (let x = 0; x < xmax; x++) {
      const k = ww !== 0 ? pre[x] / ww : pre[x];
      // normalize_coeffs_8bpc: round half away from zero into fixed point
      kk[xx * ksize + x] = k < 0 ? Math.trunc(-0.5 + k * ONE) : Math.trunc(0.5 + k * ONE);
    }
    bounds[xx * 2] = xmin;
    bounds[xx * 2 + 1] = xmax;
  }
  return { bounds, kk, ksize };
}

function clip8(v: number) {
  if (v >= MAX) return 255;
  if (v <= 0) return 0;
  return Math.floor(v / ONE);
}

/** Resize an interleaved 8-bit image (channels 3 or 4) with Pillow's LANCZOS filter. */
export function pillowLanczos(src: Uint8Array, w: number, h: number, channels: number, outW: number, outH: number): Uint8Array {
  let data = src;
  let cw = w;
  if (outW !== w) {
    const { bounds, kk, ksize } = precompute(w, outW);
    const out = new Uint8Array(outW * h * channels);
    for (let y = 0; y < h; y++) {
      const row = y * w * channels;
      for (let xx = 0; xx < outW; xx++) {
        const xmin = bounds[xx * 2];
        const xmax = bounds[xx * 2 + 1];
        const k = xx * ksize;
        for (let c = 0; c < channels; c++) {
          let ss = HALF;
          for (let x = 0; x < xmax; x++) ss += data[row + (x + xmin) * channels + c] * kk[k + x];
          out[(y * outW + xx) * channels + c] = clip8(ss);
        }
      }
    }
    data = out;
    cw = outW;
  }
  if (outH !== h) {
    const { bounds, kk, ksize } = precompute(h, outH);
    const out = new Uint8Array(cw * outH * channels);
    const stride = cw * channels;
    for (let yy = 0; yy < outH; yy++) {
      const ymin = bounds[yy * 2];
      const ymax = bounds[yy * 2 + 1];
      const k = yy * ksize;
      for (let xx = 0; xx < cw; xx++) {
        for (let c = 0; c < channels; c++) {
          let ss = HALF;
          const col = xx * channels + c;
          for (let y = 0; y < ymax; y++) ss += data[(y + ymin) * stride + col] * kk[k + y];
          out[yy * stride + col] = clip8(ss);
        }
      }
    }
    data = out;
  }
  return data;
}
