/**
 * The Cloudflare Worker: serves the SPA's static assets and the JSON API. Firestore is reached over
 * REST with a service account; files live in R2 (MinIO in development). No end-user auth in V1 —
 * Cloudflare Access gates the hostname (see docs/deploy.md).
 */
import { Hono } from 'hono';
import type { Env } from './env';
import { onError, security, type HonoEnv } from './http';
import { ai } from './routes/ai';
import { core } from './routes/core';

const app = new Hono<HonoEnv>();
app.use('/api/*', security);
app.get('/api/health', (c) => c.json({ ok: true, at: new Date().toISOString() }));
app.route('/api', core);
app.route('/api', ai);
app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found.' }, 404) : c.env.ASSETS.fetch(c.req.raw)));
app.onError(onError);

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
