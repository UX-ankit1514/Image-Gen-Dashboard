/**
 * The "connect code" the dashboard shows: the site and its one-time pairing code in one line, so a
 * single paste connects this computer to the right site.   https://studio.example.com/#123456
 */
export type ConnectCode = { url: string; code: string } | { error: string };

export function parseConnectCode(input: string): ConnectCode {
  const text = input.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!text) return { error: 'Nothing was pasted.' };
  if (/^\d{6}$/.test(text)) return { error: 'That is only the 6-digit code. Use the Copy button on the website and paste the whole line.' };
  const m = text.match(/^(\S+?)(?:\/?#|\s+)(\d{6})$/);
  if (!m) return { error: 'That does not look like a connect code. Use the Copy button on the website and paste the whole line.' };
  const site = /^[a-z][a-z0-9+.-]*:\/\//i.test(m[1]) ? m[1] : `https://${m[1]}`;
  let url: URL;
  try { url = new URL(site); } catch { return { error: 'The website address in that code is not valid.' }; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'The website address in that code is not valid.' };
  return { url: url.origin, code: m[2] };
}
