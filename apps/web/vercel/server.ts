/**
 * The API as a Vercel Function (Node.js runtime). Same Hono app as the Cloudflare Worker; settings
 * come from the project's environment variables instead of Worker bindings. Bundled into
 * `.vercel/output/functions/api.func` by `scripts/build-vercel.mjs`; every `/api/*` path is routed
 * here with its original URL.
 */
import { getRequestListener } from '@hono/node-server';
import { app } from '../worker/app';
import type { Env } from '../worker/env';

const env = process.env as unknown as Env;

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
