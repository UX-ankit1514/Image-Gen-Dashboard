#!/usr/bin/env -S npx tsx
/**
 * Arnifi Local Companion (PRD §61).
 *
 *   npm run companion -- pair --url https://studio.example.com --code 123456 [--name "Ankit's Mac"]
 *   npm run companion            # run: heartbeat + take AI tasks
 *   npm run companion -- status  # what is installed and how it is signed in
 *   npm run companion -- unpair
 *
 * It detects Claude Code and the Codex CLI, confirms they are signed in with subscriptions, receives
 * approved tasks from the dashboard, runs them locally and returns structured results. It stores only
 * the dashboard URL and its device token (mode 600). It never reads or sends passwords, cookies or
 * provider tokens, and it never calls a provider's backend directly — only the official CLIs.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, hostname, platform, tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { ProviderError, type AIProvider, type AiTask } from '@acs/providers';
import { ClaudeCodeLocal } from './providers/claude';
import { OpenAICodexLocal } from './providers/codex';

const VERSION = '0.1.0';
const DIR = join(homedir(), '.arnifi-companion');
const CONFIG = join(DIR, 'config.json');

interface Config { url: string; token: string; deviceId: string; name: string }

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function loadConfig(): Config | null {
  try { return JSON.parse(readFileSync(CONFIG, 'utf8')); } catch { return null; }
}

function log(...a: unknown[]) {
  console.log(`[${new Date().toLocaleTimeString()}]`, ...a);
}

async function call<T>(cfg: Pick<Config, 'url' | 'token'>, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${cfg.url.replace(/\/$/, '')}/api${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.token}`, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) },
    body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    ...init,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

const claude = new ClaudeCodeLocal();
const codex = new OpenAICodexLocal();
const PROVIDERS: Record<'claude' | 'openai', AIProvider> = { claude, openai: codex };

async function report() {
  const [c, x] = await Promise.all([claude.detect(), codex.detect()]);
  return { version: VERSION, claude: c, codex: { ...x, imageVerified: codex.imageVerified } };
}

async function pair() {
  const url = arg('url');
  const code = arg('code');
  if (!url || !code) {
    console.error('Usage: npm run companion -- pair --url <dashboard url> --code <6-digit code>');
    process.exit(2);
  }
  const name = arg('name') ?? hostname().replace(/\.local$/, '');
  const res = await fetch(`${url.replace(/\/$/, '')}/api/companion/pair`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, name, platform: `${platform()} companion ${VERSION}` }),
  });
  const data = await res.json() as { deviceId?: string; token?: string; error?: string };
  if (!res.ok || !data.token) {
    console.error(`Pairing failed: ${data.error ?? res.status}`);
    process.exit(1);
  }
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG, JSON.stringify({ url, token: data.token, deviceId: data.deviceId ?? "", name } satisfies Config, null, 2), { mode: 0o600 });
  chmodSync(CONFIG, 0o600);
  console.log(`Paired as "${name}". Start it with: npm run companion`);
  const r = await report();
  await call({ url, token: data.token }, '/companion/heartbeat', r);
  printStatus(r);
}

function printStatus(r: Awaited<ReturnType<typeof report>>) {
  const line = (label: string, d: typeof r.claude, extra = '') =>
    console.log(`  ${label.padEnd(8)} ${!d.installed ? 'not installed' : !d.loggedIn ? 'installed, not signed in' : d.subscriptionBacked ? `signed in with ${d.authMethod}${d.plan ? ` (${d.plan})` : ''}` : `signed in with ${d.authMethod}: refused (subscription sign-in only)`}${extra}`);
  line('Claude', r.claude);
  line('ChatGPT', r.codex, r.codex.imageVerified === false ? ' · image generation unavailable' : '');
}

async function downloadImages(urls: string[] | undefined, dir: string) {
  const out: string[] = [];
  for (const [i, u] of (urls ?? []).entries()) {
    const res = await fetch(u);
    if (!res.ok) throw new Error(`could not download input image (${res.status})`);
    const type = res.headers.get('content-type') ?? '';
    const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg';
    const p = join(dir, `input-${i + 1}${ext}`);
    writeFileSync(p, Buffer.from(await res.arrayBuffer()));
    out.push(p);
  }
  return out;
}

interface WireJob { id: string; type: string; provider: 'claude' | 'openai'; task: AiTask }

async function runJob(cfg: Config, job: WireJob) {
  const provider = PROVIDERS[job.provider];
  const dir = mkdtempSync(join(tmpdir(), 'acs-job-'));
  const stop = new AbortController();
  log(`▶ ${job.type} via ${job.provider === 'openai' ? 'ChatGPT' : 'Claude'} (${job.id})`);
  try {
    const images = await downloadImages(job.task.images, dir);
    // Each variation goes up the moment it is made, so the dashboard can show it while the next one
    // is still generating (four take ~7 minutes in total); whatever is left is sent when the run ends.
    const sent = new Set<string>();
    const upload = async (f: string) => {
      if (sent.has(f)) return;
      sent.add(f);
      const fd = new FormData();
      fd.append('file', new Blob([readFileSync(f)], { type: extname(f) === '.png' ? 'image/png' : extname(f) === '.webp' ? 'image/webp' : 'image/jpeg' }), basename(f));
      await call(cfg, `/companion/jobs/${job.id}/files`, fd);
      try { unlinkSync(f); } catch { /* temp */ }
    };
    // A run cancelled in the dashboard must stop the image in progress, not let it finish for nothing.
    const watch = setInterval(() => {
      call<{ cancelled: boolean }>(cfg, `/companion/jobs/${job.id}/state`).then((s) => { if (s.cancelled) stop.abort(); }).catch(() => { /* next tick */ });
    }, 3000);
    let result: Awaited<ReturnType<typeof provider.run>>;
    try { result = await provider.run({ ...job.task, images }, stop.signal, upload); } finally { clearInterval(watch); }
    if (stop.signal.aborted) { log(`■ ${job.id} cancelled`); return; }
    for (const f of result.images ?? []) await upload(f);
    await call(cfg, `/companion/jobs/${job.id}/result`, { ok: true, json: result.json, text: result.text?.slice(0, 190_000) });
    log(`✓ ${job.id}${result.images?.length ? ` · ${result.images.length} image(s)` : ''}`);
  } catch (e) {
    if (stop.signal.aborted) { log(`■ ${job.id} cancelled`); return; }
    const pe = e instanceof ProviderError ? e : null;
    await call(cfg, `/companion/jobs/${job.id}/result`, {
      ok: false, imageUnavailable: pe?.code === 'capability' && job.type === 'ai.image',
      error: { code: pe?.code ?? 'provider_error', message: (e as Error).message.slice(0, 1900), resetAt: pe?.resetAt ?? null },
    }).catch(() => {});
    log(`✗ ${job.id}: ${(e as Error).message.slice(0, 200)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function start() {
  const cfg = loadConfig();
  if (!cfg) {
    console.error('Not paired. In the dashboard open AI Connections → Pair a companion, then run the pair command it shows.');
    process.exit(2);
  }
  log(`Arnifi Local Companion ${VERSION} → ${cfg.url} as "${cfg.name}"`);
  let state = await report();
  printStatus(state);
  await call(cfg, '/companion/heartbeat', state).catch((e) => log('heartbeat failed:', e.message));
  setInterval(async () => {
    state = await report();
    await call(cfg, '/companion/heartbeat', state).catch((e) => log('heartbeat failed:', e.message));
  }, 60_000);

  // image work is capped at 2 in parallel: 3+ Codex image jobs hit 429 (relight experience)
  const slots = { text: 2, image: 2 };
  const busy = { text: 0, image: 0 };
  let idleSince = Date.now();
  for (;;) {
    const providers = (['claude', 'openai'] as const).filter((p) => (p === 'claude' ? state.claude : state.codex).subscriptionBacked);
    const types: string[] = [];
    if (busy.text < slots.text && providers.length) types.push('ai.text', 'ai.vision', 'ai.classify');
    if (busy.image < slots.image && providers.includes('openai')) types.push('ai.image');
    let got = false;
    if (types.length) {
      try {
        const { job } = await call<{ job: WireJob | null }>(cfg, '/companion/jobs/next', { types, providers });
        if (job) {
          got = true;
          idleSince = Date.now();
          const lane = job.type === 'ai.image' ? 'image' : 'text';
          busy[lane]++;
          void runJob(cfg, job).finally(() => { busy[lane]--; });
        }
      } catch (e) {
        log('poll failed:', (e as Error).message);
        if (/not paired/i.test((e as Error).message)) process.exit(1);
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
    if (!got) {
      const idle = Date.now() - idleSince;
      await new Promise((r) => setTimeout(r, idle < 120_000 ? 2500 : idle < 900_000 ? 6000 : 12_000));
    }
  }
}

const cmd = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'start';
if (cmd === 'pair') await pair();
else if (cmd === 'status') printStatus(await report());
else if (cmd === 'unpair') { if (existsSync(CONFIG)) unlinkSync(CONFIG); console.log('Unpaired on this Mac. Remove it in AI Connections too.'); }
else await start();
