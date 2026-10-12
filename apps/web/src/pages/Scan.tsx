/**
 * Scan results (PRD §14–15): what was found, shown before anything is generated. Pick pages, pick
 * each page's background from every image discovered on it, then create cards.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Check, ExternalLink, Images, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { SourcePage } from '@acs/types';
import { api } from '../lib/api';
import { hostOf, pathOf, plural } from '../lib/format';
import { useProject, useScan } from '../lib/queries';
import type { AssetX } from '../lib/types';
import { Badge, Button, Checkbox, cx, Dialog, Empty, Spinner, Tip } from '../ui';
import { Thumb } from '../components/Thumb';

const ROLE_LABEL: Record<string, string> = { banner: 'Primary banner', slider: 'Alternative', hero: 'Hero image', og: 'OpenGraph', content: 'Content image', alternative: 'Alternative', cached: 'Previously cached' };
const ROLE_ORDER = ['banner', 'slider', 'hero', 'og', 'content', 'alternative', 'cached'];

export function ScanPage() {
  const { pid = '', sid = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: proj } = useProject(pid);
  const { data, isLoading } = useScan(sid);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [backgrounds, setBackgrounds] = useState<Record<string, string>>({});
  const [inspect, setInspect] = useState<SourcePage | null>(null);
  const assets = useMemo(() => new Map((data?.assets ?? []).map((a) => [a.id, a])), [data]);
  const scan = data?.scan;
  const pages = data?.pages ?? [];
  const done = scan?.status === 'done';

  // default: every page without a card yet
  useEffect(() => {
    if (done && !selected.size && pages.length) setSelected(new Set(pages.filter((p) => !data?.cardsByPage[p.id] && p.status !== 'removed').map((p) => p.id)));
  }, [done, pages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const bgFor = (p: SourcePage) => {
    if (backgrounds[p.id]) return assets.get(backgrounds[p.id]) ?? null;
    const imgs = [...p.images].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
    for (const i of imgs) {
      const a = i.assetId ? assets.get(i.assetId) : null;
      if (a && a.status !== 'failed') return a;
    }
    return null;
  };

  const create = useMutation({
    mutationFn: () => api.post('/projects/' + pid + '/cards', { pageIds: [...selected], backgrounds: Object.fromEntries([...selected].map((id) => [id, bgFor(pages.find((p) => p.id === id)!)?.id]).filter(([, v]) => v)) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cards', pid] }); qc.invalidateQueries({ queryKey: ['projects'] }); navigate(`/p/${pid}`); },
    onError: (e) => toast.error(e.message),
  });
  const rescan = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/projects/${pid}/scans`, { urls: scan!.urls, rescan: true }),
    onSuccess: (s) => navigate(`/p/${pid}/scan/${s.id}`, { replace: true }),
    onError: (e) => toast.error(e.message),
  });

  const ingest = data?.ingest;
  const ingesting = ingest && ingest.completed + ingest.failed < ingest.total;
  const allSel = pages.length > 0 && selected.size === pages.length;

  return (
    <div className="mx-auto max-w-[1280px] px-8 pb-24">
      <div className="pt-6">
        <Link to={`/p/${pid}`} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"><ArrowLeft className="size-3.5" /> {proj?.project.name ?? 'Project'}</Link>
      </div>
      <header className="flex items-end justify-between gap-4 pt-2 pb-5">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">Scan results</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
            {scan?.urls.slice(0, 3).map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink">{hostOf(u)}{pathOf(u)}<ExternalLink className="size-3" /></a>)}
            {scan && scan.urls.length > 3 ? <span>+{scan.urls.length - 3} more</span> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button icon={<RefreshCw className="size-3.5" />} disabled={!done && scan?.status !== 'failed'} loading={rescan.isPending} onClick={() => rescan.mutate()}>Rescan</Button>
          <Button variant="primary" icon={<Sparkles className="size-3.5" />} disabled={!done || !selected.size} loading={create.isPending} onClick={() => create.mutate()}>
            Create {selected.size ? plural(selected.size, 'card') : 'cards'}
          </Button>
        </div>
      </header>

      {isLoading || !scan ? <div className="py-20 text-center"><Spinner className="mx-auto" /></div> : scan.status === 'failed' ? (
        <div className="rounded-xl border border-line bg-panel">
          <Empty icon={<AlertTriangle className="size-7" strokeWidth={1.5} />} title={scan.error ?? "We couldn't retrieve this page."}
            action={<div className="flex gap-2"><Button icon={<RefreshCw className="size-3.5" />} onClick={() => rescan.mutate()}>Retry</Button><a href={scan.urls[0]} target="_blank" rel="noreferrer"><Button icon={<ExternalLink className="size-3.5" />}>Open source</Button></a></div>}>
            The technical details are in the logs.
          </Empty>
        </div>
      ) : !done ? (
        <div className="rounded-xl border border-line bg-panel p-6">
          <div className="flex items-center gap-3 text-[14px]"><Loader2 className="size-4 animate-spin" /><span className="font-medium">{scan.phase || 'Scanning'}</span></div>
          <div className="mt-1 pl-7 text-[12.5px] text-muted">Reading the listing, then each detail page for its exact H1, highlights and images. Nothing is generated yet.</div>
          <div className="mt-5 flex flex-col gap-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-14 rounded-lg" />)}</div>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Stat value={plural(scan.pages, 'page')} label="found" />
            <Stat value={plural(scan.images, 'source image')} label={ingesting ? `downloading ${ingest!.completed}/${ingest!.total}` : 'found'} spinning={!!ingesting} />
            {scan.warnings.length ? <Stat value={plural(scan.warnings.length, 'warning')} label="" tone="warn" /> : null}
            {(scan.sources ?? []).map((s) => <Badge key={s.url}>{s.label}: {s.count}</Badge>)}
            {scan.changes ? <Badge tone="info">{plural(scan.changes, 'change')} since the last scan</Badge> : null}
          </div>
          {scan.warnings.length ? (
            <details className="mb-4 rounded-lg border border-line bg-panel px-4 py-2.5 text-[13px]">
              <summary className="cursor-pointer text-warn">{plural(scan.warnings.length, 'warning')}</summary>
              <ul className="mt-2 flex flex-col gap-1 text-muted">{scan.warnings.map((w, i) => <li key={i}>{w.message} {w.url ? <a className="underline" href={w.url} target="_blank" rel="noreferrer">{pathOf(w.url)}</a> : null}</li>)}</ul>
            </details>
          ) : null}
          <div className="overflow-hidden rounded-xl border border-line bg-panel">
            <div className="grid grid-cols-[36px_132px_1.3fr_1.4fr_1fr_120px] items-center gap-3 border-b border-line px-4 py-2 text-[11.5px] font-medium text-muted">
              <Checkbox checked={allSel ? true : selected.size ? 'indeterminate' : false} onCheckedChange={(v) => setSelected(v ? new Set(pages.map((p) => p.id)) : new Set())} label="Select all" />
              <span>Source image</span><span>Page</span><span>H1</span><span>Key line</span><span>Status</span>
            </div>
            {pages.map((p) => {
              const bg = bgFor(p);
              const hasCard = !!data?.cardsByPage[p.id];
              const sel = selected.has(p.id);
              return (
                <div key={p.id} onClick={() => { const n = new Set(selected); sel ? n.delete(p.id) : n.add(p.id); setSelected(n); }}
                  className={cx('grid cursor-pointer grid-cols-[36px_132px_1.3fr_1.4fr_1fr_120px] items-center gap-3 border-b border-line px-4 py-2.5 last:border-0', sel ? 'bg-[#fafafa]' : 'hoverable')}>
                  <Checkbox checked={sel} onCheckedChange={() => { const n = new Set(selected); sel ? n.delete(p.id) : n.add(p.id); setSelected(n); }} label={`Select ${p.name}`} />
                  <button onClick={(e) => { e.stopPropagation(); setInspect(p); }} className="press group relative overflow-hidden rounded-md">
                    <Thumb src={bg?.thumbUrl} pending={bg?.status === 'pending'} className="rounded-md" />
                    <span className="absolute right-1 bottom-1 inline-flex items-center gap-0.5 rounded bg-black/60 px-1 text-[10.5px] text-white"><Images className="size-3" />{p.images.length}</span>
                  </button>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium">{p.name || p.title}</div>
                    <a href={p.url} onClick={(e) => e.stopPropagation()} target="_blank" rel="noreferrer" className="block truncate text-[11.5px] text-muted hover:text-ink">{pathOf(p.url)}</a>
                    <div className="mt-0.5 truncate text-[11.5px] text-faint">{[p.country, p.authority, p.price].filter(Boolean).join(' · ')}</div>
                  </div>
                  <div className="line-clamp-2 text-[13px]">{p.h1 || <span className="text-faint">No H1 found</span>}</div>
                  <div className="line-clamp-2 text-[12.5px] text-muted">{p.highlights[0]?.title ?? <span className="text-faint">No highlights</span>}</div>
                  <div className="flex flex-col items-start gap-1">
                    {p.status === 'removed' ? <Badge tone="err">Page removed</Badge> : p.error ? <Tip label={p.error}><span><Badge tone="warn">Partial</Badge></span></Tip>
                      : !bg ? <Badge tone="warn">Needs image</Badge> : bg.status === 'pending' ? <Badge>Downloading</Badge> : <Badge tone="ok"><Check className="size-3" />Ready</Badge>}
                    {hasCard ? <span className="text-[11px] text-faint">Card exists</span> : null}
                    {bg && <AssetFlags a={bg} compact />}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {inspect ? (
        <ImageDiscovery page={inspect} assets={assets} chosen={bgFor(inspect)?.id ?? null} onClose={() => setInspect(null)}
          onChoose={(aid) => { setBackgrounds({ ...backgrounds, [inspect.id]: aid }); setInspect(null); }} />
      ) : null}
    </div>
  );
}

function Stat({ value, label, tone, spinning }: { value: string; label: string; tone?: 'warn'; spinning?: boolean }) {
  return (
    <span className={cx('inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-[13px]', tone === 'warn' && 'text-warn')}>
      {spinning ? <Loader2 className="size-3.5 animate-spin text-muted" /> : null}
      <b className="font-semibold">{value}</b> <span className="text-muted">{label}</span>
    </span>
  );
}

export function AssetFlags({ a, compact }: { a: AssetX; compact?: boolean }) {
  const f = a.flags ?? {};
  const items = [
    f.lowRes && { t: 'Low resolution', tone: 'warn' as const },
    f.duplicateOf && { t: 'Duplicate', tone: 'warn' as const },
    f.containsText ? { t: 'Contains text', tone: 'err' as const } : f.possibleText && { t: 'Possible text', tone: 'neutral' as const },
    f.containsLogo && { t: 'Contains logo', tone: 'err' as const },
    f.aspectMismatch && { t: 'Aspect ratio', tone: 'neutral' as const },
    a.status === 'failed' && { t: 'Failed', tone: 'err' as const },
  ].filter(Boolean) as { t: string; tone: 'warn' | 'err' | 'neutral' }[];
  if (!items.length) return null;
  return <div className="flex flex-wrap gap-1">{(compact ? items.slice(0, 2) : items).map((i) => <Badge key={i.t} tone={i.tone}>{i.t}</Badge>)}</div>;
}

function ImageDiscovery({ page, assets, chosen, onChoose, onClose }: { page: SourcePage; assets: Map<string, AssetX>; chosen: string | null; onChoose: (id: string) => void; onClose: () => void }) {
  const imgs = [...page.images].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={page.name || page.h1} description={`${plural(imgs.length, 'image')} found on this page. Choose the card background.`} width={920}>
      <div className="grid grid-cols-3 gap-3">
        {imgs.map((i) => {
          const a = i.assetId ? assets.get(i.assetId) : undefined;
          const isChosen = a?.id === chosen;
          return (
            <button key={i.url} disabled={!a || a.status !== 'ready'} onClick={() => a && onChoose(a.id)}
              className={cx('press overflow-hidden rounded-lg border bg-panel text-left disabled:opacity-60', isChosen ? 'border-ink shadow-[0_0_0_1px_#111]' : 'border-line hover:border-line-strong')}>
              <Thumb src={a?.thumbUrl} pending={a?.status === 'pending'} />
              <div className="flex flex-col gap-1 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-medium">{ROLE_LABEL[i.role] ?? i.role}</span>
                  {isChosen ? <Badge tone="dark">Background</Badge> : null}
                </div>
                <div className="text-[11.5px] text-muted tabular-nums">
                  {a?.status === 'ready' ? `${a.width} × ${a.height} · ${(a.mimeType.split('/')[1] ?? '').toUpperCase()}` : a?.status === 'failed' ? a.error : 'Downloading…'}
                </div>
                <a href={i.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="truncate text-[11px] text-faint hover:text-ink">{i.url}</a>
                {a ? <AssetFlags a={a} /> : null}
              </div>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
