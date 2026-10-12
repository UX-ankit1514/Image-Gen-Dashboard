/**
 * Fetching remote images without SSRF exposure (PRD §78): every hop is resolved and refused if it
 * lands on a private, loopback, link-local or reserved address; redirects are followed by hand so
 * each one is checked; bodies are size-capped. Node only.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class BlockedUrl extends Error {
  constructor(msg: string) {
    super(`blocked_url: ${msg}`);
  }
}

const allowHosts = () => (process.env.ACS_ALLOW_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

function privateV4(ip: string) {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function privateV6(ip: string) {
  const s = ip.toLowerCase();
  if (s === '::1' || s === '::') return true;
  if (s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80') || s.startsWith('ff')) return true;
  const m = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return m ? privateV4(m[1]) : false;
}

export async function checkUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedUrl('not a URL');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new BlockedUrl(`scheme ${u.protocol}`);
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (allowHosts().includes(host) || allowHosts().includes(`${host}:${port}`)) return u;
  if (!['80', '443'].includes(port)) throw new BlockedUrl(`port ${port}`);
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  for (const a of addrs) {
    if (a.family === 4 ? privateV4(a.address) : privateV6(a.address)) throw new BlockedUrl(`${host} resolves to a private address`);
  }
  return u;
}

export interface FetchedBody { bytes: Uint8Array; finalUrl: string; contentType: string }

export async function safeFetch(url: string, opts: { maxBytes: number; timeoutMs?: number; accept?: string } = { maxBytes: 80 * 1024 * 1024 }): Promise<FetchedBody> {
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    await checkUrl(current);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 90_000);
    try {
      const res = await fetch(current, {
        redirect: 'manual',
        signal: ctl.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          accept: opts.accept ?? 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5',
        },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location')!, current).toString();
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${current}`);
      const len = Number(res.headers.get('content-length') || 0);
      if (len > opts.maxBytes) throw new Error(`too large: ${len} bytes`);
      const reader = res.body!.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > opts.maxBytes) {
          await reader.cancel();
          throw new Error(`too large: over ${opts.maxBytes} bytes`);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { bytes.set(c, off); off += c.length; }
      return { bytes, finalUrl: current, contentType: res.headers.get('content-type') ?? '' };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('too many redirects');
}
