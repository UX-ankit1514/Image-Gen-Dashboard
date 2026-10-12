/**
 * Cloud "Sign in with ChatGPT" (PRD §4.1, §59): standard OAuth 2.0 authorization code + PKCE (S256)
 * with state. It stays switched off until OpenAI approves this integration and issues its endpoints
 * and client id — the app never asks for a password, cookie or API key instead.
 */
export interface OAuthConfig { authorizeUrl: string; tokenUrl: string; clientId: string; scope: string; revokeUrl?: string }

export function oauthConfig(env: { OPENAI_OAUTH_AUTHORIZE_URL?: string; OPENAI_OAUTH_TOKEN_URL?: string; OPENAI_OAUTH_CLIENT_ID?: string; OPENAI_OAUTH_SCOPE?: string; OPENAI_OAUTH_REVOKE_URL?: string }): OAuthConfig | null {
  if (!env.OPENAI_OAUTH_AUTHORIZE_URL || !env.OPENAI_OAUTH_TOKEN_URL || !env.OPENAI_OAUTH_CLIENT_ID) return null;
  return { authorizeUrl: env.OPENAI_OAUTH_AUTHORIZE_URL, tokenUrl: env.OPENAI_OAUTH_TOKEN_URL, clientId: env.OPENAI_OAUTH_CLIENT_ID, scope: env.OPENAI_OAUTH_SCOPE ?? 'openid profile email offline_access', revokeUrl: env.OPENAI_OAUTH_REVOKE_URL };
}

export function authorizeUrl(c: OAuthConfig, p: { state: string; challenge: string; redirectUri: string }) {
  const u = new URL(c.authorizeUrl);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', c.clientId);
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('scope', c.scope);
  u.searchParams.set('state', p.state);
  u.searchParams.set('code_challenge', p.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

export interface OAuthTokens { access_token: string; refresh_token?: string; expires_in?: number; id_token?: string; token_type?: string; obtained_at: number }

async function tokenRequest(c: OAuthConfig, body: Record<string, string>) {
  const res = await fetch(c.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.clientId, ...body }) });
  if (!res.ok) throw new Error(`oauth token: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { ...(await res.json() as Omit<OAuthTokens, 'obtained_at'>), obtained_at: Date.now() } as OAuthTokens;
}

export const exchangeCode = (c: OAuthConfig, p: { code: string; verifier: string; redirectUri: string }) =>
  tokenRequest(c, { grant_type: 'authorization_code', code: p.code, code_verifier: p.verifier, redirect_uri: p.redirectUri });

/** Refresh tokens are used server-side only (PRD §62). */
export const refreshTokens = (c: OAuthConfig, refreshToken: string) => tokenRequest(c, { grant_type: 'refresh_token', refresh_token: refreshToken });

export async function revokeToken(c: OAuthConfig, token: string) {
  if (!c.revokeUrl) return false;
  const res = await fetch(c.revokeUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.clientId, token }) });
  return res.ok;
}
