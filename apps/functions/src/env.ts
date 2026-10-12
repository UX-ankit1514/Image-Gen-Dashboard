/** Function runtime configuration: storage, Chrome, bundled renderer assets. */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Storage } from '@acs/storage';
import { localFontCss } from '@acs/renderer/node';
import { MAC_CHROME, Rasterizer } from '@acs/raster';

export const ASSETS = process.env.ACS_ASSETS_DIR || join(dirname(fileURLToPath(import.meta.url)), 'assets');
export const WS = 'arnifi';

let storage: Storage | null = null;
export function store() {
  storage ??= new Storage({
    endpoint: process.env.STORAGE_ENDPOINT!,
    bucket: process.env.STORAGE_BUCKET!,
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!,
    region: process.env.STORAGE_REGION || 'auto',
    publicEndpoint: process.env.STORAGE_PUBLIC_ENDPOINT || undefined,
  });
  return storage;
}

let fonts: string | null = null;
export function fontCss() {
  fonts ??= localFontCss(ASSETS);
  return fonts;
}

/** System Chrome locally (exact parity with the legacy renders); @sparticuz/chromium in the cloud. */
export async function chrome(): Promise<{ executablePath: string; args: string[]; headless: boolean | 'shell' }> {
  if (process.env.CHROME_PATH || process.platform === 'darwin') {
    return { executablePath: process.env.CHROME_PATH || MAC_CHROME, args: [], headless: true };
  }
  const chromium = (await import('@sparticuz/chromium')).default;
  return { executablePath: await chromium.executablePath(), args: chromium.args, headless: 'shell' };
}

let raster: Rasterizer | null = null;
export async function rasterizer() {
  if (!raster) {
    const c = await chrome();
    raster = new Rasterizer({ executablePath: c.executablePath, args: c.args, headless: c.headless });
  }
  return raster;
}
