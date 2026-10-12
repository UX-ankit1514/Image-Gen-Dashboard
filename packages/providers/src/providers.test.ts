import { describe, expect, it } from 'vitest';
import { buildRecipe, getLayer, updateLayer } from '@acs/renderer';
import type { GradientLayer, TextLayer } from '@acs/types';
import { applyRouted, composeGenerationPrompt, isLocalIntent, routeByRules } from './index';

const light = buildRecipe('arnifi-light');
const dark = buildRecipe('arnifi-classic');

describe('intent router (PRD §31)', () => {
  it.each([
    ['Make the gradient darker.', 'EDIT_GRADIENT'],
    ['Move the gradient more toward the left side.', 'EDIT_GRADIENT'],
    ['Reduce the purple and make it almost black.', 'EDIT_GRADIENT'],
    ['Replace the background with something related to business banking.', 'GENERATE_BACKGROUND'],
    ['Give me another person for the background.', 'GENERATE_BACKGROUND'],
    ['Generate three alternatives for this background.', 'GENERATE_VARIATIONS'],
    ['Make the subheading shorter.', 'EDIT_COPY'],
    ['Move the subject slightly right.', 'REPOSITION_LAYER'],
    ['Remove the logos', 'CHANGE_LAYOUT'],
    ['Make it 1080x1350', 'CHANGE_DIMENSIONS'],
    ["What's wrong with this card?", 'ANALYZE_CARD'],
    ['Something about synergy', 'UNKNOWN'],
  ])('%s → %s', (text, intent) => {
    expect(routeByRules(text, dark).intent).toBe(intent);
  });

  it('"make the gradient darker" changes only the gradient, never the background', () => {
    const r = routeByRules('Make the gradient darker.', dark);
    const out = applyRouted(dark, r);
    expect(isLocalIntent(r)).toBe(true);
    expect(getLayer(out, 'background')).toEqual(getLayer(dark, 'background'));
    expect(getLayer(out, 'headline')).toEqual(getLayer(dark, 'headline'));
    const before = (getLayer(dark, 'gradient') as GradientLayer).fills[0];
    const after = (getLayer(out, 'gradient') as GradientLayer).fills[0];
    expect(after.kind === 'linear' && before.kind === 'linear' && after.stops[0].alpha > before.stops[0].alpha).toBe(true);
  });

  it('a new background never touches typography', () => {
    const r = routeByRules('Give me another person for the background.', light);
    expect(r.targets).toEqual(['background']);
    expect(isLocalIntent(r)).toBe(false);
  });

  it('quoted copy is applied directly with provenance', () => {
    let d = updateLayer(light, 'headline', { text: 'Old', provenance: { kind: 'website-h1', original: 'Old' } } as Partial<TextLayer>);
    const r = routeByRules('Change the headline to "Ireland Company Setup"', d);
    d = applyRouted(d, r);
    const h = getLayer(d, 'headline') as TextLayer;
    expect(h.text).toBe('Ireland Company Setup');
    expect(h.provenance.original).toBe('Old');
  });
});

describe('prompt composer (PRD §35)', () => {
  it('builds every section in order from project memory', () => {
    const p = composeGenerationPrompt({
      project: { name: 'Legal', brief: 'Premium still life.', negativeConstraints: ['No fake logos.'], rules: [{ id: 'r', text: 'Subjects on the right.', source: 'manual', createdAt: '' }], recipeId: 'legal-services' },
      page: { url: 'https://arnifi.com/services/legal-services/aml-policy', h1: 'AML Policy', name: 'AML Policy', highlights: [{ title: 'Compliant', desc: '' }], country: 'UAE', authority: null, category: null, jurisdiction: null },
      design: light, rejections: [{ tags: ['Wrong subject', 'Looks AI-generated'], text: 'remove the building', createdAt: '' }],
      references: [{ kind: 'approved', note: 'Consent Letter' }], originalPrompt: 'a document on a desk', request: 'More professional', width: 1600, height: 1000,
    });
    const order = ['SYSTEM CREATIVE RULES', 'PROJECT RECIPE', 'PROJECT BRIEF', 'PROJECT RULES', 'PAGE CONTEXT', 'CURRENT DESIGN STATE', 'REFERENCE IMAGES', 'PREVIOUS REJECTION HISTORY', 'NEGATIVE CONSTRAINTS', 'USER REQUEST'];
    let last = -1;
    for (const h of order) {
      const i = p.indexOf(h);
      expect(i, h).toBeGreaterThan(last);
      last = i;
    }
    expect(p).toContain('Wrong subject, Looks AI-generated — "remove the building"');
    expect(p).toContain('16:10');
  });
});

import { parseUsageLimit } from './provider';
import { compact, SCHEMAS } from './tasks';

describe('usage limits (PRD §60)', () => {
  it('reads the reset time providers print', () => {
    const now = new Date('2026-10-12T15:00:00');
    const r = parseUsageLimit("You've hit your usage limit. Try again at 4:55 PM.", now);
    expect(r.limited).toBe(true);
    expect(new Date(r.resetAt!).getHours()).toBe(16);
    expect(parseUsageLimit('Selected Codex account is cooling down (429)').limited).toBe(true);
    expect(parseUsageLimit('all good').limited).toBe(false);
  });
});

describe('strict schemas', () => {
  it('every object is closed with all keys required (structured outputs)', () => {
    const walk = (s: any) => {
      if (s?.type === 'object') { expect(s.additionalProperties).toBe(false); expect(s.required.sort()).toEqual(Object.keys(s.properties).sort()); Object.values(s.properties).forEach(walk); }
      if (s?.anyOf) s.anyOf.forEach(walk);
      if (s?.items) walk(s.items);
    };
    Object.values(SCHEMAS).forEach(walk);
    expect(compact({ a: null, b: { c: 1, d: null } })).toEqual({ b: { c: 1 } });
  });
});
