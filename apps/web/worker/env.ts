import { ctxOf, RestDb, serviceAccountTokens, type Ctx } from '@acs/firestore';
import { Storage } from '@acs/storage';

export interface Env {
  ASSETS: Fetcher;
  API_LIMITER?: RateLimit;
  COMPANION_LIMITER?: RateLimit;
  FIRESTORE_PROJECT_ID: string;
  FIRESTORE_EMULATOR_HOST?: string;
  GOOGLE_SA_EMAIL?: string;
  GOOGLE_SA_KEY?: string;
  STORAGE_ENDPOINT: string;
  STORAGE_PUBLIC_ENDPOINT?: string;
  STORAGE_BUCKET: string;
  STORAGE_REGION?: string;
  STORAGE_ACCESS_KEY_ID: string;
  STORAGE_SECRET_ACCESS_KEY: string;
  /** base64 32-byte key for AES-GCM encryption of provider tokens at rest (PRD §62). */
  TOKEN_KEY?: string;
  OPENAI_OAUTH_AUTHORIZE_URL?: string;
  OPENAI_OAUTH_TOKEN_URL?: string;
  OPENAI_OAUTH_CLIENT_ID?: string;
}

interface RateLimit { limit(o: { key: string }): Promise<{ success: boolean }> }

let cached: { key: string; db: RestDb; storage: Storage } | null = null;

/** One client set per isolate; the service-account token is cached inside it. */
export function clients(env: Env) {
  const key = `${env.FIRESTORE_PROJECT_ID}|${env.FIRESTORE_EMULATOR_HOST}|${env.STORAGE_ENDPOINT}|${env.STORAGE_BUCKET}`;
  if (cached?.key === key) return cached;
  const db = new RestDb({
    projectId: env.FIRESTORE_PROJECT_ID,
    emulatorHost: env.FIRESTORE_EMULATOR_HOST || undefined,
    getToken: env.GOOGLE_SA_EMAIL && env.GOOGLE_SA_KEY ? serviceAccountTokens({ clientEmail: env.GOOGLE_SA_EMAIL, privateKey: env.GOOGLE_SA_KEY }) : undefined,
  });
  const storage = new Storage({
    endpoint: env.STORAGE_ENDPOINT,
    publicEndpoint: env.STORAGE_PUBLIC_ENDPOINT || undefined,
    bucket: env.STORAGE_BUCKET,
    region: env.STORAGE_REGION || 'auto',
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
  });
  cached = { key, db, storage };
  return cached;
}

export function ctxFor(env: Env, actor = 'owner'): Ctx {
  return ctxOf(clients(env).db, actor);
}
