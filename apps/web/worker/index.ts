/**
 * The Cloudflare Worker: serves the SPA's static assets (via the ASSETS binding) and the JSON API
 * (`app.ts`). Cloudflare Access gates the hostname (see docs/deploy.md).
 */
import { app } from './app';
import type { Env } from './env';

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
