/** Project workspace (PRD §17): filters, the card grid, multi-select and batch actions. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Clipboard, Download, FilePlus2, FileText, ImageUp, Link2, Plus, ScanEye, ScanSearch, Sparkles, Upload } from 'lucide-react';
import type { CardStatus, Scan, SourcePage } from '@acs/types';
import { api } from '../lib/api';
import { ago, plural } from '../lib/format';
import { useCards, useJobs, useProject, useScans } from '../lib/queries';
import type { AssetX, CardX } from '../lib/types';
import { Badge, Button, Checkbox, cx, Dialog, Empty, Input, Menu, MenuItem, MenuSeparator, Spinner, StatusPill, Textarea, Tip } from '../ui';
import { Thumb } from '../components/Thumb';
import { ExportDialog } from '../components/ExportDialog';
import { BatchBar, BriefDialog, DuplicatesNotice, JobsStrip, MappingDialog, SourceChangesBanner, SuggestionsPanel } from '../components/WorkspaceParts';
import { GenerateDialog } from '../editor/ai/GenerateDialog';

type Filter = 'all' | CardStatus | 'warnings';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'draft', label: 'Draft' }, { key: 'needs_review', label: 'Review' }, { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' }, { key: 'needs_image', label: 'Needs Image' }, { key: 'needs_copy', label: 'Copy Fix' },
  { key: 'exported', label: 'Exported' }, { key: 'warnings', label: 'With warnings' }, { key: 'archived', label: 'Archived' },
];

export function WorkspacePage() {
  const { pid = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: proj, isLoading: pl, error: perr } = useProject(pid);
  const { data: jobs } = useJobs(pid);
  const rendering = !!jobs?.jobs.some((j) => j.type === 'render' && ['queued', 'running'].includes(j.status));
  const { data: cards, isLoading } = useCards(pid, rendering);
  const { data: scans } = useScans(pid);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<null | 'brief' | 'export' | 'url' | 'generate' | 'mapping'>(null);
  const [urlText, setUrlText] = useState('');
  const [mapping, setMapping] = useState<string[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null);
  const lastClicked = useRef<string | null>(null);

  useEffect(() => { if (rendering) qc.invalidateQueries({ queryKey: ['cards', pid] }); }, [jobs, rendering, qc, pid]);

  const list = useMemo(() => {
    const all = cards ?? [];
    if (filter === 'all') return all.filter((c) => c.status !== 'archived');
    if (filter === 'warnings') return all.filter((c) => c.status !== 'archived' && c.warnings.some((w) => w.severity !== 'info'));
    if (filter === 'approved') return all.filter((c) => c.status === 'approved');
    return all.filter((c) => c.status === filter);
  }, [cards, filter]);
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: 0, warnings: 0 };
    for (const c of cards ?? []) {
      m[c.status] = (m[c.status] ?? 0) + 1;
      if (c.status !== 'archived') m.all++;
      if (c.status !== 'archived' && c.warnings.some((w) => w.severity !== 'info')) m.warnings++;
    }
    return m;
  }, [cards]);

  const scan = useMutation({
    mutationFn: (urls: string[]) => api.post<Scan>(`/projects/${pid}/scans`, { urls }),
    onSuccess: (s) => navigate(`/p/${pid}/scan/${s.id}`),
    onError: (e) => toast.error(e.message),
  });
  const pages = useQuery({ queryKey: ['pages', pid], queryFn: () => api.get<SourcePage[]>(`/projects/${pid}/pages`) });
  const uploads = useMutation({
    mutationFn: async ({ files, purpose }: { files: File[]; purpose: 'upload' | 'screenshot' }) => {
      const ids: string[] = [];
      for (const f of files) ids.push((await api.upload<AssetX>(`/projects/${pid}/assets`, f, { purpose })).id);
      return { ids, purpose };
    },
    onSuccess: async ({ ids, purpose }) => {
      // with scanned pages: offer the mapping screen; without: one card per image
      if ((pages.data?.length ?? 0) > 0 && purpose === 'upload') { setMapping(ids); setDialog('mapping'); return; }
      const assets = await api.post<AssetX[]>('/assets/resolve', { ids });
      for (const a of assets) await api.post(`/projects/${pid}/cards/blank`, { name: a.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '), backgroundAssetId: a.id, headline: '', subheading: '' });
      qc.invalidateQueries({ queryKey: ['cards', pid] });
      toast.success(`${plural(ids.length, 'card')} created`);
    },
    onError: (e) => toast.error(e.message),
  });
  const review = useMutation({
    mutationFn: () => api.post<{ job: { id: string } }>(`/projects/${pid}/ai/consistency`, {}),
    onSuccess: async ({ job }) => {
      toast('Reviewing the set with AI… suggestions will appear here.');
      const { waitForJob } = await import('../editor/ai/useAi');
      const done = await waitForJob(job.id);
      qc.invalidateQueries({ queryKey: ['suggestions', pid] });
      if (done.status === 'completed') toast.success('AI review ready');
      else toast.error(done.error ?? (done.status === 'paused' ? 'Paused: provider usage limit' : 'The review could not run'));
    },
    onError: (e) => toast.error(e.message),
  });
  const blank = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/projects/${pid}/cards/blank`, { name: 'Untitled card', headline: '', subheading: '' }),
    onSuccess: (c) => navigate(`/p/${pid}/c/${c.id}`),
    onError: (e) => toast.error(e.message),
  });

  useEffect(() => {
    // paste a screenshot straight into the project (PRD §16)
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,[contenteditable]')) return;
      const f = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))?.getAsFile();
      if (f) uploads.mutate({ files: [new File([f], `screenshot-${Date.now()}.png`, { type: f.type })], purpose: 'screenshot' });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [pid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea')) return;
      if (e.key === 'Escape') setSelected([]);
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') { e.preventDefault(); setSelected(list.map((c) => c.id)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [list]);

  if (perr) return <Empty icon={<AlertTriangle className="size-7" />} title={(perr as Error).message} action={<Link to="/"><Button>Back to projects</Button></Link>} />;
  if (pl || !proj) return <div className="py-24 text-center"><Spinner className="mx-auto" /></div>;
  const p = proj.project;
  const latestScan = scans?.[0];

  const click = (c: CardX, e: React.MouseEvent) => {
    if (e.shiftKey && lastClicked.current) {
      const ids = list.map((x) => x.id);
      const [a, b] = [ids.indexOf(lastClicked.current), ids.indexOf(c.id)].sort((x, y) => x - y);
      setSelected([...new Set([...selected, ...ids.slice(a, b + 1)])]);
    } else if (e.metaKey || e.ctrlKey || selected.length) {
      setSelected(selected.includes(c.id) ? selected.filter((x) => x !== c.id) : [...selected, c.id]);
    } else {
      navigate(`/p/${pid}/c/${c.id}`);
    }
    lastClicked.current = c.id;
  };

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 flex h-screen w-[184px] shrink-0 flex-col border-r border-line bg-panel px-2 pt-5">
        <Link to="/" className="mb-4 inline-flex items-center gap-1 px-2 text-[12.5px] text-muted hover:text-ink"><ArrowLeft className="size-3.5" /> Projects</Link>
        <div className="px-2 pb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Filters</div>
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => { setFilter(f.key); setSelected([]); }} className={cx('press flex h-8 items-center justify-between rounded-md px-2.5 text-[13px]', filter === f.key ? 'bg-ink text-white' : 'hoverable')}>
            {f.label}
            <span className={cx('text-[11.5px] tabular-nums', filter === f.key ? 'text-white/70' : 'text-faint')}>{counts[f.key] ?? 0}</span>
          </button>
        ))}
      </aside>

      <div className="min-w-0 flex-1 pb-28">
        <header className="flex items-end justify-between gap-4 px-8 pt-7 pb-5">
          <div className="min-w-0">
            <h1 className="truncate text-[24px] font-semibold tracking-tight">{p.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
              <span>{plural(p.stats.total, 'card')}</span><span>·</span><span>{p.width} × {p.height}</span><span>·</span><span>{proj.recipe?.name}</span><span>·</span><span>Updated {ago(p.lastEditedAt)}</span>
              {latestScan ? <><span>·</span><Link className="hover:text-ink" to={`/p/${pid}/scan/${latestScan.id}`}>Last scan {ago(latestScan.createdAt)}</Link></> : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button icon={<FileText className="size-3.5" />} onClick={() => setDialog('brief')}>Brief & rules</Button>
            <Menu trigger={<Button icon={<Plus className="size-3.5" />}>Add source</Button>}>
              <MenuItem icon={<Link2 className="size-3.5" />} onSelect={() => setDialog('url')}>Paste URL</MenuItem>
              <MenuItem icon={<ImageUp className="size-3.5" />} onSelect={() => uploadRef.current?.click()}>Upload images</MenuItem>
              <MenuItem icon={<Clipboard className="size-3.5" />} onSelect={() => toast('Press ⌘V anywhere on this page to paste a screenshot.')}>Paste screenshot</MenuItem>
              <MenuItem icon={<FilePlus2 className="size-3.5" />} onSelect={() => blank.mutate()}>Blank card</MenuItem>
              {latestScan ? <><MenuSeparator /><MenuItem icon={<ScanSearch className="size-3.5" />} onSelect={() => navigate(`/p/${pid}/scan/${latestScan.id}`)}>Scan results</MenuItem></> : null}
            </Menu>
            <Button icon={<Download className="size-3.5" />} onClick={() => setDialog('export')}>Export</Button>
            <Button icon={<ScanEye className="size-3.5" />} loading={review.isPending} onClick={() => review.mutate()}>Review set</Button>
            <Button variant="primary" icon={<Sparkles className="size-3.5" />} onClick={() => setDialog('generate')}>Generate</Button>
          </div>
          <input ref={uploadRef} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden"
            onChange={(e) => { const f = [...(e.target.files ?? [])]; if (f.length) uploads.mutate({ files: f, purpose: 'upload' }); e.target.value = ''; }} />
        </header>

        {uploads.isPending ? <div className="mx-8 mb-4 flex items-center gap-2 rounded-lg border border-line bg-panel px-3.5 py-2 text-[13px]"><Upload className="size-3.5 text-muted" /> Uploading…</div> : null}
        <JobsStrip pid={pid} />
        <SourceChangesBanner pid={pid} onRescan={() => latestScan && scan.mutate(latestScan.urls)} />
        <DuplicatesNotice pid={pid} onSelect={setSelected} />
        <SuggestionsPanel pid={pid} onOpenCard={(cid) => navigate(`/p/${pid}/c/${cid}`)} />

        {isLoading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 px-8">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton aspect-[1.25] rounded-xl" />)}</div>
        ) : list.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 px-8">
            {list.map((c) => <CardTile key={c.id} c={c} aspect={p.width / p.height} selected={selected.includes(c.id)} selecting={selected.length > 0} onClick={(e) => click(c, e)}
              onToggle={() => setSelected(selected.includes(c.id) ? selected.filter((x) => x !== c.id) : [...selected, c.id])} />)}
          </div>
        ) : filter === 'all' ? (
          <Empty icon={<FilePlus2 className="size-8" strokeWidth={1.5} />} title="No cards yet" action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDialog('url')}>Add source</Button>}>
            Paste an Arnifi link, upload an image, or start from a blank canvas.
          </Empty>
        ) : <Empty title={`No ${FILTERS.find((f) => f.key === filter)?.label.toLowerCase()} cards`} />}
      </div>

      {selected.length ? <BatchBar project={p} selected={selected} cards={cards ?? []} onClear={() => setSelected([])} onGenerate={() => setDialog('generate')} /> : null}
      {dialog === 'brief' ? <BriefDialog open onOpenChange={() => setDialog(null)} project={p} /> : null}
      {dialog === 'export' ? <ExportDialog open onOpenChange={() => setDialog(null)} projectId={pid} namingTemplate={p.namingTemplate} /> : null}
      {dialog === 'generate' ? <GenerateDialog open onOpenChange={() => setDialog(null)} projectId={pid} cardIds={selected.length ? selected : list.map((c) => c.id)} /> : null}
      {dialog === 'mapping' ? <MappingDialog open onOpenChange={() => setDialog(null)} pid={pid} assetIds={mapping}
        pages={(pages.data ?? []).map((x) => ({ id: x.id, name: x.name, h1: x.h1 }))} cardsByPage={Object.fromEntries((cards ?? []).filter((c) => c.sourcePageId).map((c) => [c.sourcePageId!, c.id]))} /> : null}
      {dialog === 'url' ? (
        <Dialog open onOpenChange={() => setDialog(null)} title="Add pages" description="One or more links. You'll see what was found before any card is made."
          footer={<><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" loading={scan.isPending} disabled={!urlText.trim()} onClick={() => scan.mutate(urlText.split(/\s+/).filter(Boolean))}>Scan</Button></>}>
          {urlText.includes('\n') ? <Textarea rows={5} value={urlText} onChange={(e) => setUrlText(e.target.value)} />
            : <Input autoFocus placeholder="https://arnifi.com/…" value={urlText} onChange={(e) => setUrlText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && urlText.trim() && scan.mutate(urlText.split(/\s+/).filter(Boolean))} />}
        </Dialog>
      ) : null}
    </div>
  );
}

function CardTile({ c, aspect, selected, selecting, onClick, onToggle }: { c: CardX; aspect: number; selected: boolean; selecting: boolean; onClick: (e: React.MouseEvent) => void; onToggle: () => void }) {
  const warn = c.warnings.filter((w) => w.severity !== 'info');
  return (
    <div onClick={onClick} className={cx('group relative cursor-pointer overflow-hidden rounded-xl border bg-panel transition-[border-color,box-shadow] duration-150', selected ? 'border-ink shadow-[0_0_0_1px_#111]' : 'border-line hover:border-line-strong')}>
      <Thumb src={c.thumbUrl} aspect={aspect} pending={!c.thumbUrl && c.status !== 'needs_image'} alt={c.name} />
      <div className={cx('absolute top-2 left-2 transition-opacity duration-150', selecting || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
        <Checkbox checked={selected} onCheckedChange={onToggle} label={`Select ${c.name}`} className="bg-white/95 shadow-sm" />
      </div>
      {warn.length ? (
        <Tip label={<div className="max-w-64">{warn.slice(0, 4).map((w, i) => <div key={i}>{w.message}</div>)}</div>}>
          <span className="absolute top-2 right-2 inline-flex h-5 items-center gap-1 rounded-full bg-white/95 px-1.5 text-[11px] font-medium text-warn shadow-sm"><AlertTriangle className="size-3" />{warn.length}</span>
        </Tip>
      ) : null}
      <div className="flex flex-col gap-1 px-3 pt-2.5 pb-3">
        <div className="truncate text-[13px] font-medium" title={c.name}>{c.name}</div>
        <div className="flex items-center gap-1.5">
          <StatusPill status={c.status} />
          <span className="text-[11.5px] text-faint">{c.sourceLabel}</span>
          <span className="ml-auto text-[11.5px] text-faint tabular-nums">{c.approvedVersionId && c.status !== 'approved' && c.status !== 'exported' ? <Badge tone="ok" className="mr-1">Approved earlier</Badge> : null}V{c.versionCount}</span>
        </div>
      </div>
    </div>
  );
}
