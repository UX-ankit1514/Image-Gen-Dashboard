/**
 * Google service-account → OAuth access token, with WebCrypto only (no Node APIs), so the
 * Cloudflare Worker can reach Firestore. The token is cached per isolate until a minute before expiry.
 */
export interface ServiceAccount { clientEmail: string; privateKey: string }

const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function pemToDer(pem: string) {
  const body = pem.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function serviceAccountTokens(sa: ServiceAccount, scope = 'https://www.googleapis.com/auth/datastore') {
  let cached: { token: string; exp: number } | null = null;
  let key: Promise<CryptoKey> | null = null;
  return async function getToken() {
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.exp - 60 > now) return cached.token;
    key ??= crypto.subtle.importKey('pkcs8', pemToDer(sa.privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({ iss: sa.clientEmail, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await key, new TextEncoder().encode(`${header}.${claims}`));
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${header}.${claims}.${b64url(sig)}`,
    });
    if (!res.ok) throw new Error(`google token: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: j.access_token, exp: now + j.expires_in };
    return cached.token;
  };
}
