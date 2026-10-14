/**
 * Vercel build, written straight to the Build Output API (v3) so nothing depends on framework
 * detection: the SPA goes to `static/`, the Hono API becomes one Node.js function at `/api`, and
 * every other path falls back to `index.html` (the SPA router takes it from there).
 *
 * Vercel also does the processing (Firestore and the bucket only store data): the job runner
 * (renders, images, exports, the browser step of a scan) is a Node.js function at
 * `/api/internal/run`, and the scanner keeps its Python code as a Python function at
 * `/api/internal/scan`.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as bundle } from 'esbuild';
import { build as viteBuild } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..', '..');
const out = join(root, '.vercel/output');
const fn = join(out, 'functions/api.func');
const runFn = join(out, 'functions/api/internal/run.func');
const scanFn = join(out, 'functions/api/internal/scan.func');
// Next to Firestore (asia-south1, docs/deploy.md): every call makes several database round trips.
const REGIONS = ['bom1'];

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
  regions: REGIONS,
}, null, 2));

// ---------------------------------------------------------------- job runner (Node.js)
// Native and file-reading packages stay real node_modules (their Linux builds come from this
// install); everything else is bundled.
const EXTERNAL = ['sharp', 'puppeteer-core', '@sparticuz/chromium', 'archiver'];
mkdirSync(runFn, { recursive: true });
await bundle({
  entryPoints: [join(repo, 'apps/functions/src/vercel.ts')],
  outfile: join(runFn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  jsx: 'automatic',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'warning',
  external: EXTERNAL,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
cpSync(join(repo, 'packages/renderer/assets/brand'), join(runFn, 'assets/brand'), { recursive: true });
mkdirSync(join(runFn, 'assets/gradients'), { recursive: true });
for (const f of ['light-grade.png', 'light-tint.png', 'light-grade-wide.png', 'light-tint-wide.png']) {
  cpSync(join(repo, 'packages/renderer/assets/gradients', f), join(runFn, 'assets/gradients', f));
}

/** Copies an installed package and, recursively, every dependency Node resolves from it (nested or
 *  hoisted), each to the same place under the function's node_modules as in this install. */
function findPackage(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) return null;
  }
}
const copied = new Set();
function copyPackage(name, from, optional = false) {
  const dir = findPackage(name, from);
  if (!dir) {
    if (optional) return;
    throw new Error(`build-vercel: ${name} is not installed (needed by the job runner)`);
  }
  const real = realpathSync(dir);
  if (copied.has(real)) return;
  copied.add(real);
  // the path after the first node_modules: "x" or "x/node_modules/y" for a nested copy
  const rel = dir.slice(dir.indexOf(`${sep}node_modules${sep}`) + `${sep}node_modules${sep}`.length);
  const own = join(dir, 'node_modules');
  cpSync(dir, join(runFn, 'node_modules', rel), { recursive: true, dereference: true, filter: (src) => src !== own && !src.startsWith(own + sep) });
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  for (const dep of Object.keys(pkg.dependencies ?? {})) copyPackage(dep, dir);
  // platform builds (sharp's libvips for linux-x64 …) are optional dependencies; only the installed ones exist
  for (const dep of Object.keys(pkg.optionalDependencies ?? {})) copyPackage(dep, dir, true);
}
for (const name of EXTERNAL) copyPackage(name, root);
writeFileSync(join(runFn, 'package.json'), JSON.stringify({ type: 'module' }));
writeFileSync(join(runFn, '.vc-config.json'), JSON.stringify({
  runtime: 'nodejs22.x',
  handler: 'index.mjs',
  launcherType: 'Nodejs',
  shouldAddHelpers: false,
  shouldAddSourcemapSupport: true,
  maxDuration: 300,
  regions: REGIONS,
}, null, 2));

// ---------------------------------------------------------------- scanner (Python)
// The Python code is copied as is; its dependencies are Linux wheels, whatever machine builds this.
mkdirSync(scanFn, { recursive: true });
const skipCache = (src) => !src.includes('__pycache__') && !src.endsWith('.pyc');
cpSync(join(repo, 'python/scanner'), join(scanFn, 'scanner'), { recursive: true, filter: skipCache });
cpSync(join(repo, 'python/legacy_pipeline'), join(scanFn, 'legacy_pipeline'), { recursive: true, filter: skipCache });
cpSync(join(repo, 'python/vercel_scan.py'), join(scanFn, 'vercel_scan.py'));
const pipArgs = ['install', '--quiet', '--disable-pip-version-check', '--target', join(scanFn, '_vendor'),
  '--platform', 'manylinux2014_x86_64', '--platform', 'manylinux_2_28_x86_64', '--implementation', 'cp',
  '--python-version', '3.12', '--only-binary=:all:', '-r', join(repo, 'python/requirements-vercel.txt')];
const installers = [
  ['python3.12', ['-m', 'pip', ...pipArgs]],
  ['python3', ['-m', 'pip', ...pipArgs]],
  ['pip3', pipArgs],
  ['uv', ['pip', 'install', '--target', join(scanFn, '_vendor'), '--python-platform', 'x86_64-manylinux_2_28',
    '--python-version', '3.12', '--only-binary', ':all:', '-r', join(repo, 'python/requirements-vercel.txt')]],
];
const failures = [];
for (const [cmd, args] of installers) {
  try {
    execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    failures.length = 0;
    break;
  } catch (err) {
    failures.push(`${cmd}: ${err.code === 'ENOENT' ? 'not installed' : `exit ${err.status}`}`);
  }
}
if (failures.length === installers.length) throw new Error(`build-vercel: could not install the scanner's Python packages (${failures.join('; ')})`);
// Vercel's Python launcher, as @vercel/python generates it: puts _vendor on the path, then hands the
// request to vercel_runtime, which serves the `handler` class in vercel_scan.py.
writeFileSync(join(scanFn, 'vc__handler__python.py'), `import importlib
import os
import os.path
import site
import sys
import time

_vc_boot_start_ms = int(time.monotonic() * 1000)
_here = os.path.dirname(__file__)
os.environ.update({
  "__VC_PY_BOOT_START_MS": str(_vc_boot_start_ms),
  "__VC_HANDLER_MODULE_NAME": "vercel_scan",
  "__VC_HANDLER_ENTRYPOINT": "vercel_scan.py",
  "__VC_HANDLER_ENTRYPOINT_ABS": os.path.join(_here, "vercel_scan.py"),
  "__VC_HANDLER_VENDOR_DIR": "_vendor",
  "__VC_HANDLER_VARIABLE_NAME": "handler"
})
_vendor = os.path.normpath(os.path.join(_here, "_vendor"))
if os.path.isdir(_vendor):
    site.addsitedir(_vendor)
    while _vendor in sys.path:
        sys.path.remove(_vendor)
    sys.path.insert(1 if (sys.path and sys.path[0] in ('', _here)) else 0, _vendor)
    importlib.invalidate_caches()

from vercel_runtime.vc_init import vc_handler
`);
writeFileSync(join(scanFn, '.vc-config.json'), JSON.stringify({
  runtime: 'python3.12',
  handler: 'vc__handler__python.vc_handler',
  architecture: 'x86_64',
  maxDuration: 300,
  regions: REGIONS,
  environment: { PYTHONPATH: '_vendor', PYTHONDONTWRITEBYTECODE: '1' },
  supportsResponseStreaming: true,
}, null, 2));

writeFileSync(join(out, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { handle: 'filesystem' },
    { src: '^/api/internal/(run|scan)$', dest: '/api/internal/$1', check: true },
    { src: '^/api(?:/.*)?$', dest: '/api', check: true },
    { src: '^/(.*)$', dest: '/index.html', check: true },
  ],
}, null, 2));

console.log('Vercel output written to .vercel/output (static + functions: api, api/internal/run, api/internal/scan)');
