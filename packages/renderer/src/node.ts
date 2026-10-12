/** Node-side defaults for tools that run against the package sources (parity harness, seeding). */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BUILTIN_ASSETS, builtinName } from './builtins';
import { fontCss } from './document';

export const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

export function builtinFile(ref: string, assetsDir = ASSETS_DIR) {
  const n = builtinName(ref);
  return n ? join(assetsDir, BUILTIN_ASSETS[n]) : null;
}

export function builtinFileUrl(ref: string, assetsDir = ASSETS_DIR) {
  const f = builtinFile(ref, assetsDir);
  return f ? pathToFileURL(f).href : null;
}

export function localFontCss(assetsDir = ASSETS_DIR) {
  const brand = join(assetsDir, 'brand');
  return fontCss(readFileSync(join(brand, 'fonts-local.css'), 'utf8'), pathToFileURL(brand).href);
}
