/**
 * The parity gate (PRD §100 Rule 3): before the new renderer is trusted, it must reproduce shipped
 * cards. Each fixture is rebuilt from its clean photo as Design JSON, rendered with the new pipeline
 * and diffed against the JPG that went live. Threshold: mean ≤ 2.0/255, the bar relight.py's
 * `verify` used (67/69 within ≤1.7/255).
 *
 *   npm run parity                # all fixtures
 *   npm run parity -- dark-02     # ids containing "dark-02"
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { designFromLegacy, type LegacyCard } from '@acs/renderer';
import { builtinFileUrl, localFontCss } from '@acs/renderer/node';
import { diffImages, MAC_CHROME, Rasterizer } from '@acs/raster';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, '..', 'fixtures');
const OUT = join(HERE, '..', 'out');
// PRD-derived bar is 2.0/255 (relight verify); the gate runs tighter so drift is caught early.
const THRESHOLD = Number(process.env.PARITY_THRESHOLD ?? 0.5);

interface Entry { id: string; photo: string; card: Omit<LegacyCard, 'photoRef'>; source: string }

const filter = process.argv.slice(2);
const manifest = (JSON.parse(readFileSync(join(FIX, 'manifest.json'), 'utf8')) as Entry[])
  .filter((m) => !filter.length || filter.some((f) => m.id.includes(f)));

mkdirSync(OUT, { recursive: true });
const raster = new Rasterizer({ executablePath: process.env.CHROME_PATH || MAC_CHROME });
const fontCss = localFontCss();
const rows: { id: string; mean: number; p99: number; max: number; ok: boolean; source: string }[] = [];

try {
  for (const m of manifest) {
    const dir = join(FIX, m.id);
    const design = designFromLegacy({ ...m.card, photoRef: 'fixture-photo' });
    const resolveSrc = (ref: string) => (ref === 'fixture-photo' ? pathToFileURL(join(dir, m.photo)).href : builtinFileUrl(ref));
    const t0 = Date.now();
    const res = await raster.render(design, { resolveSrc, fontCss, scale: 1, format: 'jpg' });
    if (res.broken.length) console.warn(`  ${m.id}: broken images ${res.broken.join(', ')}`);
    writeFileSync(join(OUT, `${m.id}.jpg`), res.buffer);
    const d = await diffImages(res.buffer, readFileSync(join(dir, 'expected.jpg')), join(OUT, `${m.id}-diff.png`));
    const ok = d.mean <= THRESHOLD;
    rows.push({ id: m.id, ...d, ok, source: m.source });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${m.id.padEnd(18)} mean ${d.mean.toFixed(2).padStart(5)}/255  p99 ${String(d.p99).padStart(3)}  max ${d.max.toFixed(0).padStart(3)}  ${Date.now() - t0}ms  ${m.source}`);
  }
} finally {
  await raster.close();
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify({ threshold: THRESHOLD, at: new Date().toISOString(), rows }, null, 2));
const failed = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} within ${THRESHOLD}/255. Renders and diff maps in tools/parity/out/`);
process.exit(failed.length ? 1 : 0);
