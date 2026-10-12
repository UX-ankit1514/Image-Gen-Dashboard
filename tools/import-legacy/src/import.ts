/**
 * Bulk import of previous card runs into Creative Studio (PRD §55 migration, §12 "Import existing
 * folder"). Each arnifi-studio run folder (data.json + images/ + final/) becomes a project; every card
 * keeps its photo, focal point, headline and key line, and the shipped JPG comes along as a reference.
 * Talks to the running app's API, exactly like the browser import.
 *
 *   npm run import -w @acs/import-legacy -- --url http://localhost:5173 \
 *       --name "Saudi Arabia (imported)" ~/Desktop/files/arnifi-studio/output/"Start your Business - all country"/02-saudi-arabia
 *   … --recipe arnifi-classic   (default: arnifi-classic, the look those runs shipped with)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
const URL_BASE = (opt('url', 'http://localhost:5173') as string).replace(/\/$/, '');
const RECIPE = opt('recipe', 'arnifi-classic') as string;
const NAME = opt('name');
const folders = args;
if (!folders.length) {
  console.error('Usage: import.ts [--url http://localhost:5173] [--name "Project"] [--recipe arnifi-classic] <run folder> [...]');
  process.exit(2);
}

const H = { 'x-acs': '1' };
async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${URL_BASE}/api${path}`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${(j as { error?: string }).error ?? r.status}`);
  return j as T;
}
async function upload(pid: string, file: string, purpose: string) {
  const fd = new FormData();
  const type = extname(file).toLowerCase() === '.png' ? 'image/png' : extname(file).toLowerCase() === '.webp' ? 'image/webp' : 'image/jpeg';
  fd.append('file', new Blob([readFileSync(file)], { type }), basename(file));
  fd.append('purpose', purpose);
  const r = await fetch(`${URL_BASE}/api/projects/${pid}/assets`, { method: 'POST', headers: H, body: fd });
  const j = await r.json() as { id?: string; error?: string };
  if (!r.ok || !j.id) throw new Error(`upload ${basename(file)}: ${j.error ?? r.status}`);
  return j.id;
}

const slug = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
const kick = (k: string) => (k || '').replace(/[\s:;,.-]+$/, '');

function csv(path: string): Record<string, string>[] {
  if (!existsSync(path)) return [];
  const rows: string[][] = [];
  const text = readFileSync(path, 'utf8');
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** A run folder, or a per-country set inside one: every directory holding a data*.json. */
function sets(root: string): string[] {
  const own = readdirSync(root).some((f) => /^data(-\d+)?\.json$/.test(f));
  if (own) return [root];
  return readdirSync(root).map((d) => join(root, d)).filter((d) => statSync(d).isDirectory()).flatMap((d) => (readdirSync(d).some((f) => /^data(-\d+)?\.json$/.test(f)) ? [d] : []));
}

for (const folder of folders) {
  const dirs = sets(folder);
  if (!dirs.length) { console.error(`no data.json under ${folder}`); continue; }
  const name = NAME ?? `${basename(folder)} (imported)`;
  const { project } = await post<{ project: { id: string } }>('/projects', {
    name, inputType: 'import', recipeId: RECIPE, width: 1600, height: 1000, provider: 'auto',
    layers: { background: true, gradient: true, logo: true, headline: true, subheading: true },
  });
  const records: Record<string, unknown>[] = [];
  for (const dir of dirs) {
    for (const df of readdirSync(dir).filter((f) => /^data(-\d+)?\.json$/.test(f)).sort()) {
      const data = JSON.parse(readFileSync(join(dir, df), 'utf8')) as Record<string, any>[];
      const index = csv(join(dir, 'final', 'INDEX.csv'));
      let n = 0;
      for (const r of data) {
        if (!r.local_image || !existsSync(join(dir, r.local_image))) continue;
        n++;
        const file = `${String(n).padStart(2, '0')}_${slug(r.slug || r.name)}.jpg`;
        const row = index.find((x) => x.file === file);
        const finalPath = join(dir, 'final', file);
        const hl = (r.highlights ?? []) as { title: string; desc: string }[];
        process.stdout.write(`  ${records.length + 1}. ${r.name}\n`);
        const assetId = await upload(project.id, join(dir, r.local_image), 'import');
        const finalAssetId = existsSync(finalPath) ? await upload(project.id, finalPath, 'reference') : null;
        records.push({
          name: r.name || r.h1 || r.slug, slug: r.slug || slug(r.name), h1: row?.headline || r.h1 || r.name,
          kicker: kick(row?.key_point || r.ai_key_line || hl[0]?.title || r.authority || r.country || ''), url: r.url || '',
          country: r.country ?? null, authority: r.authority ?? null,
          price: r.price ? `${r.currency ?? ''} ${typeof r.price === 'number' ? r.price.toLocaleString('en') : r.price}`.trim() : null,
          estTime: r.est_time ?? null, category: r.category ?? null, highlights: hl, focus: r._focus || 'center 42%', image: r.image ?? null,
          assetId, finalAssetId, position: records.length + 1,
        });
      }
    }
  }
  await post(`/projects/${project.id}/import`, { records });
  console.log(`${name}: ${records.length} cards → ${URL_BASE}/p/${project.id}`);
}
