const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short random ids ("card_k3f…"), from crypto.getRandomValues — available in Workers and Node. */
export function newId(prefix: string, length = 16) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % 36];
  return `${prefix}_${s}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function slugify(s: string, max = 64) {
  return (s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max)
    .replace(/-$/, '');
}
