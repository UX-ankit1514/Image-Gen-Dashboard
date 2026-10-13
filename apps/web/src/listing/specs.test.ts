import { describe, expect, it } from 'vitest';
import { assess, deviceById, imageBox, listingById, place, ratioLabel, safeArea } from './specs';

const card = { width: 1600, height: 1000 };

describe('listing image boxes (measured on arnifi.com)', () => {
  it('matches the live pages at the widths they were measured at', () => {
    // licence listing at a 1440 viewport: card 331.3 incl. border → image 329.3 × 205.8 (16:10)
    expect(imageBox(listingById('licence'), 1440).w).toBeCloseTo(329.33, 1);
    expect(imageBox(listingById('licence'), 1440).h).toBeCloseTo(205.83, 1);
    // services listings at 1470: card 346.7 → image 344.7 × 141
    expect(imageBox(listingById('visa'), 1470)).toEqual({ w: 344.67, h: 141 });
    expect(imageBox(listingById('postsetup'), 1470).w).toBeCloseTo(344.67, 1);
  });

  it('is one full-width column on phones', () => {
    expect(imageBox(listingById('visa'), 390)).toEqual({ w: 340, h: 141 });
  });
});

describe('placement', () => {
  it('shows a 16:10 card whole in the licence listing', () => {
    const p = place(listingById('licence'), 1440, card);
    expect(p.cut.top).toBeCloseTo(0, 5);
    expect(p.cut.left).toBeCloseTo(0, 5);
    expect(p.hover!.h).toBeLessThan(p.rest.h);
  });

  it('crops the same card to a centred strip in the visa listing, minus the 21px under the text', () => {
    const p = place(listingById('visa'), 1440, card);
    expect(p.cut.top).toBeGreaterThan(0.15);
    expect(p.rest.y + p.rest.h).toBeLessThan(p.shown.y + p.shown.h);
  });

  it('keeps a middle band that is safe on every screen', () => {
    const s = safeArea(listingById('postsetup'), card);
    expect(s.y / 1000).toBeGreaterThan(0.25);
    expect((s.y + s.h) / 1000).toBeLessThan(0.75);
  });
});

describe('size check', () => {
  const layers = [
    { id: 'logo', label: 'Logo', rect: { x: 64, y: 52, w: 196, h: 55 }, important: true },
    { id: 'headline', label: 'Headline', rect: { x: 64, y: 820, w: 900, h: 116 }, important: true },
  ];

  it('passes the 1600 × 1000 card on the licence listing', () => {
    const a = assess(listingById('licence'), deviceById('desktop'), card, layers);
    expect(a.verdict).not.toBe('bad');
    expect(a.layers.every((l) => l.rest === 'visible')).toBe(true);
  });

  it('says the logo and headline are cut off on the visa listing', () => {
    const a = assess(listingById('visa'), deviceById('desktop'), card, layers);
    expect(a.verdict).toBe('bad');
    expect(a.title).toMatch(/Logo and Headline cut off/);
  });

  it('flags a small image as blurry', () => {
    const a = assess(listingById('licence'), deviceById('wide'), { width: 320, height: 200 }, null);
    expect(a.verdict).toBe('bad');
  });

  it('names common ratios', () => {
    expect(ratioLabel(1.6)).toBe('16:10');
    expect(ratioLabel(344.67 / 141)).toBe('2.44:1');
  });
});
