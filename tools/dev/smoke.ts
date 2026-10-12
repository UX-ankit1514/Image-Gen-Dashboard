/**
 * End-to-end smoke test against the running local stack (npm run dev):
 * project → scan a live Arnifi URL → cards → renders. Prints ids for the UI.
 *   npx tsx tools/dev/smoke.ts [url]
 */
const B = process.env.ACS_URL ?? 'http://localhost:5173/api';
const H = { 'x-acs': '1', 'content-type': 'application/json' };
const url = process.argv[2] ?? 'https://arnifi.com/services/will-drafting';
const get = async (p: string) => (await fetch(B + p)).json();
const post = async (p: string, b: unknown) => {
  const r = await fetch(B + p, { method: 'POST', headers: H, body: JSON.stringify(b) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${p}: ${r.status} ${JSON.stringify(j)}`);
  return j;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const t0 = Date.now();
const { project, scan } = await post('/projects', {
  name: 'Smoke ' + new URL(url).pathname.split('/').pop(), inputType: 'url', urls: [url], recipeId: 'arnifi-light', width: 1600, height: 1000,
  layers: { background: true, gradient: true, logo: true, headline: true, subheading: true }, provider: 'auto',
});
console.log('project', project.id, 'scan', scan.id);
let v: any;
for (;;) {
  v = await get(`/scans/${scan.id}`);
  const b = v.ingest;
  if (v.scan.status === 'failed') throw new Error(v.scan.error);
  if (v.scan.status === 'done' && (!b || b.completed + b.failed >= b.total)) break;
  await sleep(1500);
}
console.log(`scan: ${v.pages.length} pages, ${v.scan.images} images (${v.ingest?.failed ?? 0} failed) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const cards = await post(`/projects/${project.id}/cards`, { pageIds: v.pages.map((p: any) => p.id) });
for (;;) {
  const { jobs } = await get(`/projects/${project.id}/jobs`);
  const r = jobs.filter((j: any) => j.type === 'render');
  if (r.length >= cards.length && r.every((j: any) => ['completed', 'failed'].includes(j.status))) {
    console.log(`renders: ${r.filter((j: any) => j.status === 'completed').length}/${r.length} ok`, r.filter((j: any) => j.error).map((j: any) => j.error));
    break;
  }
  await sleep(1500);
}
const list = await get(`/projects/${project.id}/cards`);
for (const c of list) console.log(' ', c.id, c.status, c.thumbUrl ? 'thumb' : 'NO THUMB', c.warnings.map((w: any) => w.code).join(','), '·', c.name);
console.log(`total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
export {};
