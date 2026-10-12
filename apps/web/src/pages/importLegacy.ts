/**
 * "Import existing folder" (PRD §12): a folder from a previous arnifi-studio run — data.json (or
 * data-NN.json) records, images/, final/ — becomes a project with one card per record, keeping the
 * photo, the focal point, the headline and the key line that shipped. The shipped JPG comes along as
 * a reference image.
 */
import { api } from '../lib/api';

export interface LegacyRecord {
  name: string; slug: string; h1: string; kicker: string; url: string; country: string | null; authority: string | null;
  price: string | null; estTime: string | null; category: string | null; highlights: { title: string; desc: string }[];
  focus: string; image: string | null; photo: File; final: File | null; position: number;
}
export interface LegacyFolder { name: string; records: LegacyRecord[]; withFinal: number }

const slug = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
const kick = (k: string) => (k || '').replace(/[\s:;,.-]+$/, '');

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
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

export async function readLegacyFolder(files: File[]): Promise<LegacyFolder> {
  const byPath = new Map(files.map((f) => [(f as File & { webkitRelativePath: string }).webkitRelativePath || f.name, f]));
  const dataFiles = [...byPath.keys()].filter((p) => /(^|\/)data(-\d+)?\.json$/.test(p));
  if (!dataFiles.length) throw new Error('No data.json found. Choose a run folder (or a country folder inside one).');
  const root = [...byPath.keys()][0]?.split('/')[0] ?? 'Imported project';
  const records: LegacyRecord[] = [];
  let withFinal = 0;
  for (const dp of dataFiles.sort()) {
    const dir = dp.split('/').slice(0, -1).join('/');
    const data = JSON.parse(await byPath.get(dp)!.text()) as Record<string, any>[];
    const indexPath = [`${dir}/final/INDEX.csv`, `${dir.split('/')[0]}/final/INDEX.csv`].find((p) => byPath.has(p));
    const index = indexPath ? parseCsv(await byPath.get(indexPath)!.text()) : [];
    const usable = data.filter((r) => r.local_image);
    usable.forEach((r, i) => {
      const photo = byPath.get(`${dir}/${r.local_image}`);
      if (!photo) return;
      const file = `${String(i + 1).padStart(2, '0')}_${slug(r.slug || r.name)}.jpg`;
      const finalPath = [`${dir}/final/${file}`].find((p) => byPath.has(p));
      const row = index.find((x) => x.file === file);
      if (finalPath) withFinal++;
      const hl = (r.highlights ?? []) as { title: string; desc: string }[];
      records.push({
        name: r.name || r.h1 || r.slug, slug: r.slug || slug(r.name), h1: row?.headline || r.h1 || r.name,
        kicker: kick(row?.key_point || r.ai_key_line || hl[0]?.title || r.authority || r.country || ''),
        url: r.url || '', country: r.country ?? null, authority: r.authority ?? null,
        price: r.price ? `${r.currency ?? ''} ${typeof r.price === 'number' ? r.price.toLocaleString('en') : r.price}`.trim() : null,
        estTime: r.est_time ?? null, category: r.category ?? null, highlights: hl, focus: r._focus || 'center 42%', image: r.image ?? null,
        photo, final: finalPath ? byPath.get(finalPath)! : null, position: records.length + 1,
      });
    });
  }
  if (!records.length) throw new Error('The folder has data but none of its photos. Include the images/ folder.');
  return { name: root.replace(/[-_]+/g, ' '), records, withFinal };
}

export async function importFolder(pid: string, folder: LegacyFolder, onProgress: (s: string) => void) {
  const out: Record<string, unknown>[] = [];
  let done = 0;
  const queue = [...folder.records];
  async function worker() {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const photo = await api.upload<{ id: string }>(`/projects/${pid}/assets`, r.photo, { purpose: 'import' });
      const final = r.final ? await api.upload<{ id: string }>(`/projects/${pid}/assets`, r.final, { purpose: 'reference' }) : null;
      const { photo: _p, final: _f, ...rest } = r;
      out.push({ ...rest, assetId: photo.id, finalAssetId: final?.id ?? null });
      onProgress(`Uploading ${++done} of ${folder.records.length}`);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  onProgress('Creating cards');
  out.sort((a, b) => (a.position as number) - (b.position as number));
  await api.post(`/projects/${pid}/import`, { records: out });
}
