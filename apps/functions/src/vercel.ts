/**
 * The job runner as a Vercel Function (`/api/internal/run`), for deployments without Firebase
 * Functions: Firestore and the bucket only store data, and the processing happens here. The API
 * calls it after every change that may queue work, and its own polls call it again when work has
 * been waiting too long, so nothing depends on a trigger. Bundled by apps/web/scripts/build-vercel.mjs.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RestDb, serviceAccountTokens } from '@acs/firestore';
import { runnerToken, sameSecret } from '@acs/shared';
import { drain } from './runner';

/** Leaves the rest of the 300 s for the job that is still running when the budget ends. */
const BUDGET_MS = 150_000;

let db: RestDb | null = null;
function database() {
  const env = process.env;
  db ??= new RestDb({
    projectId: env.FIRESTORE_PROJECT_ID!,
    emulatorHost: env.FIRESTORE_EMULATOR_HOST || undefined,
    getToken: env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_KEY ? serviceAccountTokens({ clientEmail: env.GOOGLE_SA_EMAIL, privateKey: env.GOOGLE_SA_KEY }) : undefined,
  });
  return db;
}

/** POSTs to a sibling function and lets it run on: only delivery is waited for, not the work. */
async function poke(url: string, token: string, body: unknown) {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-acs-runner': token }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) });
    await res.body?.cancel();
  } catch { /* still running after 4 s, or the next poll starts it again */ }
}

type WaitUntil = (p: Promise<unknown>) => void;
const waitUntil = () => (globalThis as { [k: symbol]: { get?: () => { waitUntil?: WaitUntil } } })[Symbol.for('@vercel/request-context')]?.get?.()?.waitUntil;

export default async function runner(req: IncomingMessage, res: ServerResponse) {
  const send = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
  const key = process.env.TOKEN_KEY;
  if (req.method !== 'POST' || !key) return send(404, { error: 'Not found.' });
  const token = await runnerToken(key);
  if (!sameSecret(req.headers['x-acs-runner'] as string | undefined, token)) return send(403, { error: 'Request blocked.' });
  req.resume();
  const origin = `${(req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ?? 'https'}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
  const work = drain(database(), {
    budgetMs: BUDGET_MS,
    kickScan: (scanId) => poke(`${origin}/api/internal/scan`, token, { scanId }),
    kickRunner: () => poke(`${origin}/api/internal/run`, token, {}),
  }).catch((err) => { console.error('runner failed', err); return { busy: false, ran: 0, error: true }; });
  const wait = waitUntil();
  if (wait) {
    wait(work);
    return send(202, { accepted: true });
  }
  return send(200, await work);
}
