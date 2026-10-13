import { describe, expect, it } from 'vitest';
import { friendly, hamming, matchUploads, renderName, sniffImage, uniqueNames } from './index';

describe('naming (PRD §69)', () => {
  it('default template', () => {
    expect(renderName('{project}-{card}-{version}', { project: 'Ireland Company Setup', card: 'Premium Registration', version: 4 }, 'png'))
      .toBe('ireland-company-setup-premium-registration-v4.png');
  });
  it('dedupes', () => expect(uniqueNames(['a.png', 'a.png', 'b.png'])).toEqual(['a.png', 'a-2.png', 'b.png']));
});

describe('friendly errors (PRD §81)', () => {
  it('never shows the raw error', () => {
    expect(friendly(new Error('FetchError ECONNRESET'))).toBe("We couldn't retrieve this page.");
  });
  it('says so when the preview renderer (Chrome) dies, instead of a generic message', () => {
    const closed = new Error('Connection closed.');
    closed.name = 'ConnectionClosedError';
    expect(friendly(closed)).toBe('The preview renderer stopped unexpectedly. Retry to render it again.');
  });
});

describe('file sniffing', () => {
  it('detects by content', () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniffImage(new TextEncoder().encode('<html>'))).toBeNull();
  });
  it('hamming', () => expect(hamming('ff00', 'ff01')).toBe(1));
});

describe('upload ↔ page matching (PRD §95)', () => {
  const pages = [
    { id: 'p1', slug: 'aml-policy', title: 'AML Policy' },
    { id: 'p2', slug: 'consent-letter-drafting', title: 'Consent Letter Drafting' },
    { id: 'p3', slug: 'employment-contract', title: 'Employment Contract' },
  ];
  it('matches by slug and title, leaves unmatched pages empty', () => {
    const r = matchUploads(['aml.png', 'Employment-Contract-final.jpg'], pages);
    expect(r[1]).toMatchObject({ pageId: 'p3', confidence: 1 });
    expect(r[0].pageId).toBe('p1');
    expect(r[0].confidence).toBeLessThan(1);
  });
});

import { decryptJson, encryptJson, pairingCode, pkcePair } from './crypto';

describe('crypto (PRD §62)', () => {
  it('encrypts provider tokens at rest', async () => {
    const key = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i)));
    const box = await encryptJson(key, { refresh: 'secret' });
    expect(box.data).not.toContain('secret');
    expect(await decryptJson(key, box)).toEqual({ refresh: 'secret' });
  });
  it('pairing codes are 6 digits and PKCE uses S256', async () => {
    expect(pairingCode()).toMatch(/^\d{6}$/);
    const p = await pkcePair();
    expect(p.method).toBe('S256');
    expect(p.challenge).not.toBe(p.verifier);
  });
});
