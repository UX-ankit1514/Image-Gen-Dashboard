// Bundles the functions (and the workspace packages they use) into dist/ with a deployable
// package.json, the renderer's fonts/logo/gradient assets, and — for the emulator — .env.local.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const dist = join(here, 'dist');
const watch = process.argv.includes('--watch');
const dev = process.argv.includes('--dev') || watch;
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const EXTERNAL = ['firebase-admin', 'firebase-functions', 'sharp', 'puppeteer-core', '@sparticuz/chromium', 'archiver'];

mkdirSync(dist, { recursive: true });
cpSync(join(root, 'packages/renderer/assets/brand'), join(dist, 'assets/brand'), { recursive: true });
mkdirSync(join(dist, 'assets/gradients'), { recursive: true });
for (const f of ['light-grade.png', 'light-tint.png', 'light-grade-wide.png', 'light-tint-wide.png']) {
  cpSync(join(root, 'packages/renderer/assets/gradients', f), join(dist, 'assets/gradients', f));
}
writeFileSync(join(dist, 'package.json'), JSON.stringify({
  name: 'acs-functions', private: true, type: 'module', main: 'index.js', engines: { node: '22' },
  dependencies: Object.fromEntries(EXTERNAL.map((d) => [d, pkg.dependencies[d]])),
}, null, 2));
if (!dev) {
  // production: never ship the emulator's env or secrets; non-secret settings come from the shell
  // (STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_PUBLIC_ENDPOINT), secrets from Secret Manager
  rmSync(join(dist, '.env.local'), { force: true });
  rmSync(join(dist, '.secret.local'), { force: true });
  const env = ['STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_REGION', 'STORAGE_PUBLIC_ENDPOINT']
    .filter((k) => process.env[k]).map((k) => `${k}=${process.env[k]}`);
  if (!process.env.STORAGE_ENDPOINT) console.warn('warning: STORAGE_ENDPOINT is not set; the deployed functions will not reach R2');
  writeFileSync(join(dist, '.env'), env.join('\n') + '\n');
}
if (dev) {
  const env = [
    'STORAGE_ENDPOINT=http://127.0.0.1:9000', 'STORAGE_BUCKET=arnifi-studio', 'STORAGE_REGION=us-east-1',
    `CHROME_PATH=${process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}`,
    `ACS_ASSETS_DIR=${join(dist, 'assets')}`,
  ];
  writeFileSync(join(dist, '.env.local'), env.join('\n') + '\n');
  writeFileSync(join(dist, '.secret.local'), 'STORAGE_ACCESS_KEY_ID=acsdev\nSTORAGE_SECRET_ACCESS_KEY=acsdevsecret\n');
}

const opts = {
  entryPoints: [join(here, 'src/index.ts')],
  bundle: true, platform: 'node', target: 'node22', format: 'esm', outfile: join(dist, 'index.js'),
  external: EXTERNAL, jsx: 'automatic', sourcemap: true, logLevel: 'info',
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
};
if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
} else {
  await build(opts);
}
