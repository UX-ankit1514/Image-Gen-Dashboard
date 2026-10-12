/** Dev helper: screenshot app routes in headless Chrome and print console errors.
 *   npx tsx tools/dev/shot.ts <outdir> <path> [<path> ...]   (paths like /, /p/<id>) */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const [out, ...paths] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 } });
const page = await browser.newPage();
const errors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') errors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 400)}`));
for (const [i, p] of paths.entries()) {
  const [path, wait] = p.split('@');
  await page.goto(`http://localhost:5173${path}`, { waitUntil: 'networkidle2', timeout: 60_000 }).catch((e) => errors.push(`goto ${path}: ${e}`));
  await new Promise((r) => setTimeout(r, Number(wait ?? 1500)));
  const f = join(out, `${String(i + 1).padStart(2, '0')}-${path.replace(/[^a-z0-9]+/gi, '_').slice(0, 60) || 'home'}.png`);
  await page.screenshot({ path: f });
  console.log('shot', f);
}
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
