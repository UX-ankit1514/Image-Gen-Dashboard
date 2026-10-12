// The whole stack locally, offline: MinIO (S3) · Firestore + Functions emulators · functions bundle
// watcher · Vite with the Cloudflare Worker (via @cloudflare/vite-plugin).
//   npm run dev           → http://localhost:5173   (emulator UI: http://127.0.0.1:4000)
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AwsClient } from 'aws4fetch';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const data = join(root, '.data');
mkdirSync(join(data, 'minio'), { recursive: true });
const S3 = { endpoint: 'http://127.0.0.1:9000', user: 'acsdev', pass: 'acsdevsecret', bucket: 'arnifi-studio' };
const PROJECT = 'demo-arnifi-studio';
const colors = { minio: 33, emu: 35, fn: 36, web: 32, dev: 37 };
const procs = [];

function run(name, cmd, args, opts = {}) {
  const p = spawn(cmd, args, { cwd: root, env: { ...process.env, ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `\x1b[${colors[name] ?? 37}m${name.padEnd(5)}\x1b[0m`;
  const out = (b) => b.toString().split('\n').filter(Boolean).forEach((l) => console.log(`${tag} ${l}`));
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  p.on('exit', (code) => console.log(`${tag} exited ${code}`));
  procs.push(p);
  return p;
}

async function waitFor(url, ms = 30000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    try { await fetch(url); return; } catch { await new Promise((r) => setTimeout(r, 300)); }
  }
  throw new Error(`timed out waiting for ${url}`);
}

const keyFile = join(data, 'token.key');
if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString('base64'));
writeFileSync(join(root, 'apps/web/.dev.vars'), [
  'FIRESTORE_EMULATOR_HOST=127.0.0.1:8080',
  `FIRESTORE_PROJECT_ID=${PROJECT}`,
  `STORAGE_ENDPOINT=${S3.endpoint}`,
  `STORAGE_ACCESS_KEY_ID=${S3.user}`,
  `STORAGE_SECRET_ACCESS_KEY=${S3.pass}`,
  'STORAGE_REGION=us-east-1',
  `TOKEN_KEY=${readFileSync(keyFile, 'utf8').trim()}`,
].join('\n') + '\n');

run('minio', 'minio', ['server', join(data, 'minio'), '--address', '127.0.0.1:9000', '--console-address', '127.0.0.1:9001', '--quiet'],
  { env: { MINIO_ROOT_USER: S3.user, MINIO_ROOT_PASSWORD: S3.pass } });
await waitFor(`${S3.endpoint}/minio/health/live`);
const aws = new AwsClient({ accessKeyId: S3.user, secretAccessKey: S3.pass, service: 's3', region: 'us-east-1' });
const head = await aws.fetch(`${S3.endpoint}/${S3.bucket}`, { method: 'HEAD' });
if (!head.ok) await aws.fetch(`${S3.endpoint}/${S3.bucket}`, { method: 'PUT' });
console.log(`\x1b[37mdev  \x1b[0m bucket ${S3.bucket} ready`);

spawnSync('node', ['apps/functions/build.mjs', '--dev'], { cwd: root, stdio: 'inherit' });
run('fn', 'node', ['apps/functions/build.mjs', '--watch']);
mkdirSync(join(data, 'firestore'), { recursive: true });
const importArgs = existsSync(join(data, 'firestore', 'firebase-export-metadata.json')) ? ['--import', join(data, 'firestore')] : [];
run('emu', 'firebase', ['emulators:start', '--only', 'firestore,functions', '--project', PROJECT, ...importArgs, '--export-on-exit', join(data, 'firestore')]);
await waitFor('http://127.0.0.1:8080/');
run('web', 'npm', ['run', 'dev', '-w', '@acs/web']);

const stop = () => {
  for (const p of procs.reverse()) p.kill('SIGINT');
  setTimeout(() => process.exit(0), 4000);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
