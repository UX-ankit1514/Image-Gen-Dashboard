/**
 * The JSON API as one Hono app, shared by the Cloudflare Worker (`index.ts`) and the Vercel Function
 * (`../vercel/server.ts`). Firestore is reached over REST with a service account; files live in an
 * S3-compatible bucket (R2 in production, MinIO in development). No end-user auth in V1 — the host
 * is gated in front of the app (see docs/deploy.md).
 */
import { Hono } from 'hono';
import { missingConfig } from './env';
import { onError, security, type HonoEnv } from './http';
import { kickRunner } from './runner';
import { ai } from './routes/ai';
import { core } from './routes/core';

export const app = new Hono<HonoEnv>();
app.use('/api/*', security);
// any change may queue work (renders, images, exports, scans); companion polls never do
const QUIET = /^\/api\/companion\/(heartbeat|jobs\/next|jobs\/[^/]+\/state)$/;
app.use('/api/*', async (c, next) => {
  await next();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.res.status < 400 && !QUIET.test(c.req.path)) kickRunner(c);
});
app.get('/api/health', (c) => c.json({ ok: true, at: new Date().toISOString(), missing: missingConfig(c.env) }));
app.route('/api', core);
app.route('/api', ai);
app.notFound((c) => (c.req.path.startsWith('/api/') || !c.env.ASSETS ? c.json({ error: 'Not found.' }, 404) : c.env.ASSETS.fetch(c.req.raw)));
app.onError(onError);
