#!/usr/bin/env -S npx tsx
/**
 * Arnifi Local Companion (PRD §61).
 *
 *   npm run companion -- connect # ask for the connect code the website shows, pair, then keep running
 *   npm run companion -- pair --url https://studio.example.com --code 123456 [--name "Ankit's Mac"]
 *   npm run companion            # run: heartbeat + take AI tasks
 *   npm run companion -- status  # what is installed and how it is signed in
 *   npm run companion -- unpair [--url https://studio.example.com]
 *
 * One companion can serve several Creative Studio sites (say localhost and the live site): each
 * `pair` adds a site, and a running companion picks a new pairing up within seconds. Only one
 * companion runs per computer; a second one says so and leaves. Works on macOS and Windows.
 * It detects Claude Code and the Codex CLI, confirms they are signed in with subscriptions, receives
 * approved tasks from the dashboard, runs them locally and returns structured results. It stores only
 * the dashboard URL and its device token (mode 600). It never reads or sends passwords, cookies or
 * provider tokens, and it never calls a provider's backend directly — only the official CLIs.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir, hostname, platform, tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { ProviderError, type AIProvider, type AiTask } from '@acs/providers';
import { ClaudeCodeLocal } from './providers/claude';
import { OpenAICodexLocal } from './providers/codex';
import { parseConnectCode } from './connect';

const VERSION = '0.1.0';
const DIR = join(homedir(), '.arnifi-companion');
const CONFIG = join(DIR, 'config.json');
const LOCK = join(DIR, 'running.pid');

interface Config { url: string; token: string; deviceId: string; name: string }

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const originOf = (url: string) => new URL(url).origin;

/** Every paired site. An older config held exactly one site at the top level. */
function loadSites(): Config[] {
  try {
    const raw = JSON.parse(readFileSync(CONFIG, 'utf8')) as { sites?: Config[] } & Partial<Config>;
    return Array.isArray(raw.sites) ? raw.sites : raw.url && raw.token ? [raw as Config] : [];
  } catch { return []; }
}

function saveSites(sites: Config[]) {
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG, JSON.stringify({ sites }, null, 2), { mode: 0o600 });
  chmodSync(CONFIG, 0o600);
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

/** Pairs this computer with a site. Returns a plain-language problem, or null when it worked. */
async function pairWith(url: string, code: string, name: string, show: boolean): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/$/, '')}/api/companion/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, name, platform: `${platform()} companion ${VERSION}` }),
    });
  } catch {
    return `Could not reach ${originOf(url)}. Check your internet connection and try again.`;
  }
  const data = await res.json().catch(() => ({})) as { deviceId?: string; token?: string; error?: string };
  if (!res.ok || !data.token) return `Pairing failed: ${(data.error ?? `error ${res.status}`).replace(/[.\s]+$/, '')}. (A code works once and lasts 10 minutes.)`;
  // a new pairing with the same site replaces the old one; other sites stay paired
  saveSites([...loadSites().filter((s) => originOf(s.url) !== originOf(url)), { url, token: data.token, deviceId: data.deviceId ?? '', name }]);
  console.log(`Connected to ${originOf(url)} as "${name}".`);
  if (show) {
    const r = await report();
    await call({ url, token: data.token }, '/companion/heartbeat', r);
    printStatus(r);
  }
  return null;
}

const deviceName = () => arg('name') ?? hostname().replace(/\.local$/, '');

async function pair() {
  const url = arg('url');
  const code = arg('code');
  if (!url || !code) {
    console.error('Usage: npm run companion -- pair --url <website address> --code <6-digit code>\n   or: npm run companion -- connect');
    process.exit(2);
  }
  const problem = await pairWith(url, code, deviceName(), true);
  if (problem) { console.error(problem); process.exit(1); }
  console.log('If the companion is running it picks this up in a few seconds; otherwise start it with: npm run companion');
}

/** Reads lines from the terminal one question at a time; null once nothing more can be read. One reader for the whole session, so lines pasted together are not lost. */
function lineReader() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const queue: string[] = [];
  let waiting: ((line: string | null) => void) | null = null;
  let closed = false;
  rl.on('line', (l) => { if (waiting) { const w = waiting; waiting = null; w(l); } else queue.push(l); });
  rl.on('close', () => { closed = true; if (waiting) { const w = waiting; waiting = null; w(null); } });
  return {
    ask: (question: string) => new Promise<string | null>((resolve) => {
      process.stdout.write(question);
      if (queue.length) resolve(queue.shift()!);
      else if (closed) resolve(null);
      else waiting = resolve;
    }),
    close: () => rl.close(),
  };
}

/**
 * What the double-click launchers run: ask for the connect code the website shows (or just carry on
 * when this computer is already connected), pair, and keep running. One step for the person.
 */
async function connect() {
  console.log('\n  Creative Studio helper\n  ----------------------');
  const known = loadSites();
  const reader = lineReader();
  let given = process.argv.slice(3).filter((a) => !a.startsWith('--')).join(' ');
  for (;;) {
    const text = given || await reader.ask(known.length
      ? '\n  Paste the connect code from the website and press Enter.\n  (Already connected? Just press Enter to start the helper.)\n  > '
      : '\n  Paste the connect code from the website and press Enter.\n  > ');
    given = '';
    if (text === null) { console.error('\n  No keyboard input is available here.'); process.exit(2); }
    if (!text.trim()) {
      if (known.length) break;
      console.log('  Nothing pasted yet. On the website, press Copy next to the connect code.');
      continue;
    }
    const parsed = parseConnectCode(text);
    if ('error' in parsed) { console.log(`  ${parsed.error}`); continue; }
    const problem = await pairWith(parsed.url, parsed.code, deviceName(), false);
    if (!problem) break;
    console.log(`  ${problem}`);
  }
  reader.close();
  await start();
}

/** Only one helper runs per computer. A lock file, touched while running, tells a second one to leave. */
function takeLock(): boolean {
  try {
    const pid = Number(readFileSync(LOCK, 'utf8'));
    const fresh = Date.now() - statSync(LOCK).mtimeMs < 90_000;
    if (pid && pid !== process.pid && fresh) {
      try { process.kill(pid, 0); return false; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EPERM') return false; }
    }
  } catch { /* no lock yet */ }
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  writeFileSync(LOCK, String(process.pid));
  setInterval(() => { try { utimesSync(LOCK, new Date(), new Date()); } catch { /* next time */ } }, 20_000).unref();
  const drop = () => { try { if (readFileSync(LOCK, 'utf8') === String(process.pid)) unlinkSync(LOCK); } catch { /* gone */ } };
  process.on('exit', drop);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => process.exit(0));
  return true;
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
  let sites = loadSites();
  if (!sites.length) {
    console.error('Not connected to any website yet. On the website open AI Connections → Sign in with ChatGPT, then double-click "Creative Studio Helper" and paste the connect code.\nOr run: npm run companion -- connect');
    process.exit(2);
  }
  if (!takeLock()) {
    console.log('The helper is already running on this computer. It picks up a new connection within a few seconds, so you can close this window.');
    process.exit(0);
  }
  let configTime = existsSync(CONFIG) ? statSync(CONFIG).mtimeMs : 0;
  log(`Arnifi Local Companion ${VERSION} as "${sites[0].name}" → ${sites.map((x) => originOf(x.url)).join(', ')}`);
  let state = await report();
  printStatus(state);
  const beat = (s: Config) => call(s, '/companion/heartbeat', state).catch((e) => log(`heartbeat to ${originOf(s.url)} failed:`, e.message));
  await Promise.all(sites.map(beat));
  setInterval(async () => {
    state = await report();
    await Promise.all(sites.map(beat));
  }, 60_000);

  // "Sign in with ChatGPT" from a dashboard: the CLI's own browser sign-in, then every site hears of it
  let signingIn = false;
  const signIn = async (site: Config) => {
    if (signingIn) {
      await call(site, '/companion/sign-in/result', { provider: 'openai', ok: false, message: 'A ChatGPT sign-in is already open on this computer. Finish it in the browser.' }).catch(() => {});
      return;
    }
    signingIn = true;
    log('▶ opening the ChatGPT sign-in in your browser');
    try {
      const r = await codex.signIn();
      state = await report();
      await Promise.all(sites.map(beat));
      await call(site, '/companion/sign-in/result', { provider: 'openai', ok: r.ok, message: r.message }).catch((e) => log('sign-in result failed:', e.message));
      log(r.ok ? '✓ signed in to ChatGPT' : `✗ ChatGPT sign-in: ${r.message}`);
      printStatus(state);
    } finally {
      signingIn = false;
    }
  };

  // image work is capped at 2 in parallel: 3+ Codex image jobs hit 429 (relight experience)
  const slots = { text: 2, image: 2 };
  const busy = { text: 0, image: 0 };
  let idleSince = Date.now();
  for (;;) {
    // a pairing made while running (another site, or a re-pair) is picked up here
    const t = existsSync(CONFIG) ? statSync(CONFIG).mtimeMs : 0;
    if (t !== configTime) {
      configTime = t;
      const next = loadSites();
      for (const s of next.filter((n) => !sites.some((o) => o.token === n.token))) { log(`paired with ${originOf(s.url)}`); void beat(s); }
      sites = next;
      if (!sites.length) { log('Unpaired from every site. Stopping.'); process.exit(0); }
    }
    const providers = (['claude', 'openai'] as const).filter((p) => (p === 'claude' ? state.claude : state.codex).subscriptionBacked);
    let got = false;
    for (const site of sites) {
      const types: string[] = [];
      if (busy.text < slots.text && providers.length) types.push('ai.text', 'ai.vision', 'ai.classify');
      if (busy.image < slots.image && providers.includes('openai')) types.push('ai.image');
      // always ask, even with no free slot or nothing signed in: a sign-in request arrives this way
      try {
        const { job, signIn: wants } = await call<{ job: WireJob | null; signIn?: 'openai' }>(site, '/companion/jobs/next', { types, providers });
        if (wants === 'openai') { got = true; idleSince = Date.now(); void signIn(site); }
        if (job) {
          got = true;
          idleSince = Date.now();
          const lane = job.type === 'ai.image' ? 'image' : 'text';
          busy[lane]++;
          void runJob(site, job).finally(() => { busy[lane]--; });
        }
      } catch (e) {
        log(`poll ${originOf(site.url)} failed:`, (e as Error).message);
        if (/not paired/i.test((e as Error).message)) {
          log(`${originOf(site.url)} unpaired this computer; removing it here too.`);
          saveSites(loadSites().filter((x) => x.token !== site.token));
        }
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
else if (cmd === 'connect') await connect();
else if (cmd === 'status') printStatus(await report());
else if (cmd === 'unpair') {
  const url = arg('url');
  if (url) saveSites(loadSites().filter((s) => originOf(s.url) !== originOf(url)));
  else if (existsSync(CONFIG)) unlinkSync(CONFIG);
  console.log(`Unpaired ${url ? originOf(url) : 'every site'} on this computer. Remove it in AI Connections too.`);
}
else await start();
