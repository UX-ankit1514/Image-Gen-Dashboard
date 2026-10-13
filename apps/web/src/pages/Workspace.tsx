/** The project overview: every card as it will ship. Generate makes new backgrounds, Export downloads. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Loader2, Download, Eye, EyeOff, FilePlus2, Link2, MoreHorizontal, Sparkles } from 'lucide-react';
import type { BatchAction, Scan } from '@acs/types';
import { api } from '../lib/api';
import { ago, plural } from '../lib/format';
import { useCards, useJobs, useProject } from '../lib/queries';
import type { CardX } from '../lib/types';
import { Button, Checkbox, cx, Dialog, Empty, IconButton, Input, Menu, MenuItem, Spinner, Textarea } from '../ui';
import { Thumb } from '../components/Thumb';
import { BatchBar, JobsStrip } from '../components/WorkspaceParts';

export function WorkspacePage() {
  const { pid = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: proj, isLoading: pl, error: perr } = useProject(pid);
  const { data: jobs } = useJobs(pid);
  const rendering = !!jobs?.jobs.some((j) => j.type === 'render' && ['queued', 'running'].includes(j.status));
  const { data: cards, isLoading } = useCards(pid, rendering);
  const updating = useMemo(() => new Set((jobs?.jobs ?? []).filter((j) => j.type === 'render' && ['queued', 'running'].includes(j.status) && j.cardId).map((j) => j.cardId!)), [jobs]);
  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [urlText, setUrlText] = useState('');
  // Generate asks first (what will be made, for which cards) and Export shows the cards before the
  // download: both are their own screens, for the selected cards or for all of them
  const go = (step: 'generate' | 'export', ids: string[]) => navigate(`/p/${pid}/${step}${ids.length ? `?cards=${ids.join(',')}` : ''}`);
  const lastClicked = useRef<string | null>(null);

  useEffect(() => { if (rendering) qc.invalidateQueries({ queryKey: ['cards', pid] }); }, [jobs, rendering, qc, pid]);

  const list = useMemo(() => (cards ?? []).filter((c) => c.status !== 'archived'), [cards]);

  const scan = useMutation({
    mutationFn: (urls: string[]) => api.post<Scan>(`/projects/${pid}/scans`, { urls }),
    onSuccess: (s) => navigate(`/p/${pid}/scan/${s.id}`),
    onError: (e) => toast.error(e.message),
  });
  // the first line (the small line above the heading) is off by default; this turns it off or on for every card
  const firstLine = useMutation({
    mutationFn: (visible: boolean) => api.post<{ changed: number }>(`/projects/${pid}/batch`, { cardIds: list.map((c) => c.id), scope: 'selected', op: { action: 'toggle_layer', layerId: 'subheading', visible } satisfies BatchAction }),
    onSuccess: (r, visible) => { toast.success(`First line ${visible ? 'shown' : 'hidden'} on ${plural(r.changed, 'card')}`); qc.invalidateQueries({ queryKey: ['cards', pid] }); qc.invalidateQueries({ queryKey: ['jobs', pid] }); },
    onError: (e) => toast.error(e.message),
  });
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
    <div className="mx-auto min-h-full max-w-[1280px] pb-28">
      <header className="flex items-end justify-between gap-4 px-8 pt-7 pb-5">
        <div className="min-w-0">
          <Link to="/" className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"><ArrowLeft className="size-3.5" /> Projects</Link>
          <h1 className="truncate text-[24px] font-semibold tracking-tight">{p.name}</h1>
          <div className="mt-1 text-[13px] text-muted">{plural(list.length, 'card')} · {p.width} × {p.height} · Updated {ago(p.lastEditedAt)}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button icon={<Download className="size-3.5" />} disabled={!list.length} onClick={() => go('export', selected)}>Export</Button>
          <Button variant="primary" icon={<Sparkles className="size-3.5" />} disabled={!list.length} onClick={() => go('generate', selected)}>Generate</Button>
          <Menu align="end" trigger={<IconButton label="More"><MoreHorizontal className="size-4" /></IconButton>}>
            <MenuItem icon={<EyeOff className="size-3.5" />} disabled={!list.length || firstLine.isPending} onSelect={() => firstLine.mutate(false)}>Hide the first line on all cards</MenuItem>
            <MenuItem icon={<Eye className="size-3.5" />} disabled={!list.length || firstLine.isPending} onSelect={() => firstLine.mutate(true)}>Show the first line on all cards</MenuItem>
          </Menu>
        </div>
      </header>

      <JobsStrip pid={pid} />

      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-5 px-8">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton aspect-[1.25] rounded-xl" />)}</div>
      ) : list.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-5 px-8">
          {list.map((c) => <CardTile key={c.id} c={c} aspect={p.width / p.height} updating={updating.has(c.id)} selected={selected.includes(c.id)} selecting={selected.length > 0} onClick={(e) => click(c, e)}
            onToggle={() => setSelected(selected.includes(c.id) ? selected.filter((x) => x !== c.id) : [...selected, c.id])} />)}
        </div>
      ) : (
        <Empty icon={<FilePlus2 className="size-8" strokeWidth={1.5} />} title="No cards yet" action={<Button variant="primary" icon={<Link2 className="size-4" />} onClick={() => setAdding(true)}>Add a link</Button>}>
          Paste an Arnifi page link and its card is made from the page.
        </Empty>
      )}

      {selected.length ? <BatchBar project={p} selected={selected} onClear={() => setSelected([])} onGenerate={() => go('generate', selected)} onDownload={() => go('export', selected)} /> : null}
      {adding ? (
        <Dialog open onOpenChange={() => setAdding(false)} title="Add pages" description="One or more links. You'll see what was found before any card is made."
          footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" loading={scan.isPending} disabled={!urlText.trim()} onClick={() => scan.mutate(urlText.split(/\s+/).filter(Boolean))}>Scan</Button></>}>
          {urlText.includes('\n') ? <Textarea rows={5} value={urlText} onChange={(e) => setUrlText(e.target.value)} />
            : <Input autoFocus placeholder="https://arnifi.com/…" value={urlText} onChange={(e) => setUrlText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && urlText.trim() && scan.mutate(urlText.split(/\s+/).filter(Boolean))} />}
        </Dialog>
      ) : null}
    </div>
  );
}

function CardTile({ c, aspect, updating, selected, selecting, onClick, onToggle }: { c: CardX; aspect: number; updating?: boolean; selected: boolean; selecting: boolean; onClick: (e: React.MouseEvent) => void; onToggle: () => void }) {
  return (
    <div onClick={onClick} className={cx('group relative cursor-pointer overflow-hidden rounded-xl border bg-panel transition-[border-color,box-shadow] duration-150', selected ? 'border-ink shadow-[0_0_0_1px_#111]' : 'border-line hover:border-line-strong hover:shadow-[0_6px_20px_-10px_rgba(0,0,0,0.2)]')}>
      <Thumb src={c.thumbUrl} aspect={aspect} pending={!c.thumbUrl && c.status !== 'needs_image'} alt={c.name} />
      {updating ? (
        // a new version is rendering (e.g. a new background was just applied): say so over the old image
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center bg-black/35" style={{ aspectRatio: String(aspect) }}>
          <span className="flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11.5px] font-medium"><Loader2 className="size-3 animate-spin" />Updating…</span>
        </div>
      ) : null}
      <div className={cx('absolute top-2 left-2 transition-opacity duration-150', selecting || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
        <Checkbox checked={selected} onCheckedChange={onToggle} label={`Select ${c.name}`} className="bg-white/95 shadow-sm" />
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1 truncate text-[13px] font-medium" title={c.name}>{c.name}</div>
        {c.status === 'needs_image' ? <span className="shrink-0 text-[11.5px] text-warn">No image</span> : null}
      </div>
    </div>
  );
}
