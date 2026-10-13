import { existsSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import type { Browser } from 'puppeteer-core';
import type { Design } from '@acs/types';
import { MAC_CHROME, Rasterizer, isBrowserGone } from './index';

const chrome = process.env.CHROME_PATH || MAC_CHROME;
const design = { canvas: { width: 320, height: 200, background: '#123456' }, layers: [] } as unknown as Design;
const opts = { resolveSrc: (s: string) => s, fontCss: '' };

describe('isBrowserGone', () => {
  it('recognises a lost DevTools connection, not card problems', () => {
    const closed = new Error('Connection closed.');
    closed.name = 'ConnectionClosedError';
    expect(isBrowserGone(closed)).toBe(true);
    expect(isBrowserGone(new Error('Protocol error (Target.createTarget): Target closed'))).toBe(true);
    expect(isBrowserGone(new Error('net::ERR_FILE_NOT_FOUND'))).toBe(false);
    expect(isBrowserGone('Connection closed')).toBe(false);
  });
});

// The grid went blank because one cached Chrome lost its connection and was never replaced.
describe.skipIf(!existsSync(chrome))('Rasterizer recovers from a dead Chrome', () => {
  const r = new Rasterizer({ executablePath: chrome });
  afterAll(() => r.close());
  const cached = () => [...(r as unknown as { browsers: Map<string, Promise<Browser>> }).browsers.values()][0]!;

  it('renders, then renders again after the DevTools connection drops (Chrome still running)', async () => {
    const first = await r.capture(design, opts);
    expect(first.png.length).toBeGreaterThan(100);
    const b = await cached();
    const proc = b.process()!;
    b.disconnect();                       // what happened locally: connection gone, process left behind
    const again = await r.capture(design, opts);
    expect(again.png.length).toBeGreaterThan(100);
    await new Promise((res) => setTimeout(res, 500));
    expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true);   // no orphaned Chrome left running
  }, 60_000);

  it('renders again after Chrome is killed outright', async () => {
    const b = await cached();
    b.process()!.kill('SIGKILL');
    const again = await r.capture(design, opts);
    expect(again.png.length).toBeGreaterThan(100);
  }, 60_000);

  it('serves concurrent renders after a crash without relaunching a Chrome per card', async () => {
    (await cached()).process()!.kill('SIGKILL');
    const all = await Promise.all([1, 2, 3, 4, 5].map(() => r.capture(design, opts)));
    expect(all.every((x) => x.png.length > 100)).toBe(true);
    expect((r as unknown as { browsers: Map<string, unknown> }).browsers.size).toBe(1);
  }, 90_000);
});
