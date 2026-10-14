/**
 * The API as a Vercel Function (Node.js runtime). Same Hono app as the Cloudflare Worker; settings
 * come from the project's environment variables instead of Worker bindings. Bundled into
 * `.vercel/output/functions/api.func` by `scripts/build-vercel.mjs`; every `/api/*` path is routed
 * here with its original URL.
 */
import { getRequestListener } from '@hono/node-server';
import { runnerToken } from '@acs/shared';
import { app } from '../worker/app';
import type { Env } from '../worker/env';
import { setRunnerKicker } from '../worker/runner';

const env = process.env as unknown as Env;

type WaitUntil = (p: Promise<unknown>) => void;
const waitUntil = () => (globalThis as { [k: symbol]: { get?: () => { waitUntil?: WaitUntil } } })[Symbol.for('@vercel/request-context')]?.get?.()?.waitUntil;

// No Firebase Functions here: jobs run in the sibling function /api/internal/run (apps/functions/src/vercel.ts).
let token: Promise<string> | null = null;
let last = 0;
if (env.TOKEN_KEY) {
  setRunnerKicker((origin) => {
    // one kick per second is plenty: the runner drains the whole queue
    if (Date.now() - last < 1000) return;
    last = Date.now();
    token ??= runnerToken(env.TOKEN_KEY!);
    const send = token
      .then((t) => fetch(`${origin}/api/internal/run`, { method: 'POST', headers: { 'x-acs-runner': t }, signal: AbortSignal.timeout(4000) }))
      .then((r) => r.body?.cancel())
      // a runner without waitUntil works while we wait: still running after 4 s means it was delivered
      .catch((err) => { if ((err as Error).name !== 'TimeoutError') console.warn('runner kick failed', (err as Error).message); });
    waitUntil()?.(send);
  });
}

/** Vercel terminates TLS in front of the function, so restore the public scheme for absolute URLs. */
function publicRequest(req: Request): Request {
  const proto = req.headers.get('x-forwarded-proto');
  const url = new URL(req.url);
  if (!proto || url.protocol === `${proto}:`) return req;
  url.protocol = proto;
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, { method: req.method, headers: req.headers, body: hasBody ? req.body : undefined, signal: req.signal, ...(hasBody ? { duplex: 'half' } : {}) } as RequestInit);
}

export default getRequestListener((req) => app.fetch(publicRequest(req), env), { overrideGlobalObjects: false });
