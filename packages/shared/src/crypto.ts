/**
 * Small WebCrypto helpers (Workers and Node): device tokens, pairing codes, PKCE, and AES-GCM for
 * provider tokens at rest (PRD §62, §78).
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64ToBytes(b64: string) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return b64url(b);
}

/** A uniformly random 6-digit code (rejection sampling, no modulo bias). */
export function pairingCode() {
  const b = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(b);
    if (b[0] < 4_294_000_000) return String(b[0] % 1_000_000).padStart(6, '0');
  }
}

export async function sha256Text(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function pkcePair() {
  const verifier = randomToken(48);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
  return { verifier, challenge, method: 'S256' as const };
}

async function aesKey(keyB64: string) {
  const raw = b64ToBytes(keyB64);
  if (raw.length !== 32) throw new Error('TOKEN_KEY must be 32 bytes, base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptJson(keyB64: string, value: unknown) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyB64), enc.encode(JSON.stringify(value)));
  return { iv: b64url(iv), data: b64url(new Uint8Array(ct)) };
}

export async function decryptJson<T>(keyB64: string, box: { iv: string; data: string }): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(box.iv) }, await aesKey(keyB64), b64ToBytes(box.data));
  return JSON.parse(dec.decode(pt)) as T;
}

/** Constant-time comparison of two equal-length hex strings. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
