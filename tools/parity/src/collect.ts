/**
 * Copies a small, deliberately varied set of shipped cards into fixtures/ so the parity gate does
 * not depend on ~/Desktop staying as it is. Run once; the fixtures are committed.
 *
 *   dark  — arnifi-studio run "Start your Business - all country" (card.py, studio font stack)
 *   light — relight.py country pages (studio stack, one boosted card) + UAE (legacy font stack)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanKicker, type LegacyCard } from '@acs/renderer';

const FILES = join(homedir(), 'Desktop', 'files');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

interface Fixture { id: string; card: Omit<LegacyCard, 'photoRef'>; photo: string; expected: string; note: string }

const slug = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);

function csv(path: string): Record<string, string>[] {
  const rows: string[][] = [];
  const text = readFileSync(path, 'utf8');
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

function darkFixtures(): Fixture[] {
  const run = join(FILES, 'arnifi-studio', 'output', 'Start your Business - all country');
  const all: (Fixture & { len: number; focus: string })[] = [];
  for (const set of ['01-saint-vincent-and-the-grenadines', '02-saudi-arabia', '03-british-virgin-islands', '05-singapore', '06-mauritius', '08-hong-kong', '09-ireland', '10-cyprus']) {
    const dir = join(run, set);
    if (!existsSync(join(dir, 'data.json'))) continue;
    const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8')) as Record<string, any>[];
    const index = csv(join(dir, 'final', 'INDEX.csv'));
    const usable = data.filter((r) => r.local_image);
    usable.forEach((r, i) => {
      const file = `${String(i + 1).padStart(2, '0')}_${slug(r.slug || r.name)}.jpg`;
      const row = index.find((x) => x.file === file);
      if (!row || r.crop) return;
      all.push({
        id: `dark-${set.slice(0, 2)}-${String(i + 1).padStart(2, '0')}`,
        card: { recipe: 'arnifi-classic', title: row.headline, kicker: cleanKicker(row.key_point), focus: r._focus || 'center 42%', stack: 'studio' },
        photo: join(dir, r.local_image), expected: join(dir, 'final', file),
        note: `${set}/${file}`, len: row.headline.length, focus: r._focus || 'center 42%',
      });
    });
  }
  // a short, a 49–62 char, a >62 char headline, and every non-default focal point present
  const pick: typeof all = [];
  const add = (f?: (typeof all)[number]) => { if (f && !pick.includes(f)) pick.push(f); };
  add(all.find((f) => f.len <= 34));
  add(all.find((f) => f.len > 34 && f.len <= 48));
  add(all.find((f) => f.len > 48 && f.len <= 62));
  add(all.find((f) => f.len > 62));
  for (const f of all.filter((x) => x.focus !== 'center 42%').slice(0, 2)) add(f);
  for (const f of all) if (pick.length < 6) add(f);
  return pick;
}

function lightFixtures(): Fixture[] {
  const sys = join(FILES, 'new images', '_system');
  const pages: [string, string, string, number][] = [
    ['sg', join(sys, 'pages', 'sg', 'sources.json'), 'Start your Business - company - Singapore', 2],
    ['ksa', join(sys, 'pages', 'ksa', 'sources.json'), 'Start your Business - company - Saudi Arabia', 3],
    ['hk', join(sys, 'pages', 'hk', 'sources.json'), 'Start your Business - company - Hong Kong', 1],
    ['uae', join(sys, 'sources.json'), 'Start your Business - company - UAE', 3],
  ];
  const out: Fixture[] = [];
  for (const [key, src, name, n] of pages) {
    if (!existsSync(src)) continue;
    const list = JSON.parse(readFileSync(src, 'utf8')) as Record<string, any>[];
    // boosted cards first, then cards without per-card layout surgery
    const ordered = [...list.filter((c) => c.boost), ...list.filter((c) => !c.boost && !(c.layout && Object.keys(c.layout).length))];
    for (const c of ordered.slice(0, n)) {
      const expected = join(FILES, 'new images', name, c.folder || '', c.file);
      if (!existsSync(expected) || !existsSync(c.photo)) continue;
      out.push({
        id: `light-${key}-${String(c.pos).padStart(2, '0')}`,
        card: { recipe: 'arnifi-light', title: c.title, kicker: c.kicker, focus: c.focus, stack: c.stack,
          boost: !!c.boost, layout: c.layout && Object.keys(c.layout).length ? c.layout : undefined, suffix: c.suffix || undefined },
        photo: c.photo, expected, note: `${name}/${c.folder}/${c.file}${c.boost ? ' (boost)' : ''} [${c.stack}]`,
      });
    }
  }
  return out;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const fixtures = [...darkFixtures(), ...lightFixtures()];
const manifest = fixtures.map((f) => {
  const dir = join(OUT, f.id);
  mkdirSync(dir, { recursive: true });
  const photo = `photo${extname(f.photo).toLowerCase()}`;
  copyFileSync(f.photo, join(dir, photo));
  copyFileSync(f.expected, join(dir, 'expected.jpg'));
  return { id: f.id, photo, card: f.card, source: f.note, sourcePhoto: basename(f.photo) };
});
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`${manifest.length} fixtures`);
for (const m of manifest) console.log(`  ${m.id.padEnd(18)} ${m.source}`);
