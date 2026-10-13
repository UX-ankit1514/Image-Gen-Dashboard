/**
 * The last step: the cards as they will be saved, and one Export button. It downloads straight to the
 * browser: the image itself for one card, a ZIP of only the images for several. Format and size come
 * from Settings (JPG at the card size by default); there is nothing to choose here.
 */
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, CheckCircle2, Download, Loader2 } from 'lucide-react';
import { plural } from '../lib/format';
import { useDownload } from '../lib/download';
import { useBootstrap, useCards, useJobs, useProject } from '../lib/queries';
import { Button, Spinner } from '../ui';
import { Thumb } from '../components/Thumb';

const FORMAT = { jpg: 'JPEG', png: 'PNG', webp: 'WebP' } as const;

export function ExportPage() {
  const { pid = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: proj } = useProject(pid);
  const { data: boot } = useBootstrap();
  const { data: jobs } = useJobs(pid);
  const rendering = !!jobs?.jobs.some((j) => j.type === 'render' && ['queued', 'running'].includes(j.status));
  const { data: cards, isLoading } = useCards(pid, rendering);
  const updating = useMemo(() => new Set((jobs?.jobs ?? []).filter((j) => j.type === 'render' && ['queued', 'running'].includes(j.status) && j.cardId).map((j) => j.cardId!)), [jobs]);
  const { download, busy } = useDownload();
  const [saved, setSaved] = useState<string | null>(null);

  const all = useMemo(() => (cards ?? []).filter((c) => c.status !== 'archived'), [cards]);
  const only = params.get('cards')?.split(',').filter(Boolean) ?? [];
  const list = only.length ? all.filter((c) => only.includes(c.id)) : all;
  const ready = list.filter((c) => c.currentVersionId);
  const p = proj?.project;
  const format = FORMAT[boot?.workspace.settings.exportFormat ?? 'jpg'];
  const aspect = p ? p.width / p.height : 1.6;

  const run = async () => {
    setSaved(null);
    const name = await download(pid, only.length ? { cardIds: ready.map((c) => c.id) } : 'all', ready.length);
    if (name) setSaved(name);
  };

  return (
    <div className="mx-auto max-w-[1180px] px-8 pb-24">
      <div className="pt-6">
        <Link to={`/p/${pid}`} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"><ArrowLeft className="size-3.5" /> {p?.name ?? 'Project'}</Link>
      </div>
      <header className="flex items-end justify-between gap-4 pt-2 pb-5">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-tight">Export</h1>
          <div className="mt-1 text-[13px] text-muted">
            {plural(ready.length, 'card')} · {format}{p ? ` · ${p.width} × ${p.height}` : ''} · {ready.length === 1 ? 'one image' : 'one ZIP of images'}, saved by your browser
          </div>
        </div>
        <Button variant="primary" icon={busy ? undefined : <Download className="size-4" />} loading={busy} disabled={!ready.length} onClick={() => void run()} data-testid="export-run">
          {busy ? `Preparing ${plural(ready.length, 'image')}…` : `Export ${plural(ready.length, 'card')}`}
        </Button>
      </header>

      {saved && !busy ? (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-[#cfe6d6] bg-ok-bg px-3.5 py-2.5 text-[13px] text-ok" role="status" data-testid="export-done">
          <CheckCircle2 className="size-4 shrink-0" />
          <span className="min-w-0 flex-1"><b className="font-medium">{saved}</b> is in your Downloads folder.</span>
          <Button size="sm" onClick={() => void run()}>Download again</Button>
          <Link to={`/p/${pid}`}><Button size="sm" variant="ghost">Back to the project</Button></Link>
        </div>
      ) : null}

      {only.length && all.length > list.length ? (
        <div className="mb-4 text-[12.5px] text-muted">
          Showing {only.length === 1 ? 'this card' : `these ${list.length} cards`} only.{' '}
          <button className="font-medium text-ink hover:underline" onClick={() => { setSaved(null); setParams({}, { replace: true }); }}>Export all {all.length} cards instead</button>
        </div>
      ) : null}

      {isLoading ? <div className="flex justify-center py-16"><Spinner /></div> : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
          {list.map((c) => (
            <div key={c.id} className="overflow-hidden rounded-xl border border-line bg-panel">
              <div className="relative">
                <Thumb src={c.thumbUrl} aspect={aspect} pending={!c.thumbUrl && c.status !== 'needs_image'} alt={c.name} />
                {updating.has(c.id) ? (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
                    <span className="flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11.5px] font-medium"><Loader2 className="size-3 animate-spin" />Updating…</span>
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={c.name}>{c.name}</span>
                {!c.currentVersionId ? <span className="shrink-0 text-[11.5px] text-warn">Not included: no image yet</span> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
