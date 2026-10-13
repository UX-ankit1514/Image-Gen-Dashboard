/**
 * Vercel build, written straight to the Build Output API (v3) so nothing depends on framework
 * detection: the SPA goes to `static/`, the Hono API becomes one Node.js function at `/api`, and
 * every other path falls back to `index.html` (the SPA router takes it from there).
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as bundle } from 'esbuild';
import { build as viteBuild } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.vercel/output');
const fn = join(out, 'functions/api.func');

process.env.ACS_TARGET = 'vercel';
rmSync(out, { recursive: true, force: true });
rmSync(join(root, 'dist'), { recursive: true, force: true });

await viteBuild({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'warn' });
cpSync(join(root, 'dist'), join(out, 'static'), { recursive: true });

mkdirSync(fn, { recursive: true });
await bundle({
  entryPoints: [join(root, 'vercel/server.ts')],
  outfile: join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  jsx: 'automatic',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'warning',
  // CommonJS dependencies inside an ES module bundle still call require().
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

writeFileSync(join(fn, '.vc-config.json'), JSON.stringify({
  runtime: 'nodejs22.x',
  handler: 'index.mjs',
  launcherType: 'Nodejs',
  shouldAddHelpers: false,
  shouldAddSourcemapSupport: true,
  supportsResponseStreaming: true,
  // Next to Firestore (asia-south1, docs/deploy.md): every API call makes several database round trips.
  regions: ['bom1'],
}, null, 2));

writeFileSync(join(out, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { handle: 'filesystem' },
    { src: '^/api(?:/.*)?$', dest: '/api', check: true },
    { src: '^/(.*)$', dest: '/index.html', check: true },
  ],
}, null, 2));

console.log('Vercel output written to .vercel/output (static + functions/api.func)');
