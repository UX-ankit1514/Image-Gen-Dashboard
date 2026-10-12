/** Request plumbing: validation, errors as sentences (PRD §81), CSRF + rate limiting (PRD §78). */
import type { Context, MiddlewareHandler } from 'hono';
import type { z } from 'zod';
import { FirestoreError, NeedsConfirmation } from '@acs/firestore';
import { AppError, friendly, invalid } from '@acs/shared';
import type { Env } from './env';

export type HonoEnv = { Bindings: Env };
export type C = Context<HonoEnv>;

export async function body<T extends z.ZodType>(c: C, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw invalid('The request body is not valid JSON.');
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    throw invalid(`Check ${first?.path.join('.') || 'the form'}: ${first?.message ?? 'invalid value'}.`, JSON.stringify(r.error.issues).slice(0, 2000));
  }
  return r.data;
}

export function onError(err: Error, c: C) {
  if (err instanceof NeedsConfirmation) {
    return c.json({ error: err.message, needsConfirm: true, unapproved: err.unapproved, total: err.total }, 409);
  }
  if (err instanceof AppError) {
    if (err.detail) console.warn(err.code, err.detail);
    return c.json({ error: err.userMessage, code: err.code }, err.status as 400);
  }
  if (err instanceof FirestoreError && err.status === 404) return c.json({ error: "We couldn't find that." }, 404);
  console.error(err);
  return c.json({ error: friendly(err) }, 500);
}

/** Mutations need the SPA's header and a same-origin Origin; the companion has its own token auth. */
export const security: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const companion = path.startsWith('/api/companion/');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !companion) {
    if (c.req.header('x-acs') !== '1') return c.json({ error: 'Request blocked.' }, 403);
    const origin = c.req.header('origin');
    if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.json({ error: 'Request blocked.' }, 403);
  }
  const limiter = companion ? c.env.COMPANION_LIMITER : c.env.API_LIMITER;
  if (limiter && c.req.method !== 'GET') {
    const key = c.req.header('cf-connecting-ip') ?? 'local';
    const { success } = await limiter.limit({ key: `${companion ? 'c' : 'a'}:${key}` });
    if (!success) return c.json({ error: 'Too many requests. Wait a moment and try again.' }, 429);
  }
  await next();
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'same-origin');
};
