/**
 * New backgrounds for a set of cards (PRD §33–34, §64). "Generate" first asks which cards to change and
 * how the photos are described: either the project's brief (each card's prompt is composed from its page,
 * the brief and the photo style) or a prompt the person writes. Only the background photo is made; text,
 * logo and layout stay. A run can be cancelled; what was already made stays to choose from.
 *
 * Results arrive card by card. Each card shows two images to choose from, Previous (the card as it
 * is) and Updated (the card with the new background); nothing changes until the choice is applied.
 * "Done" opens the final choice for every card and applies it, so leaving never silently drops the
 * new images. Images from earlier runs on the same cards (last 24 hours) are offered too, and "Try
 * again" makes another one for a card inside this run, so the screen survives a reload. Applying the
 * choice continues to the Export screen.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Ban, Check, ChevronDown, Loader2, MonitorSmartphone, PauseCircle, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';
import { CardScene, replaceBackground } from '@acs/renderer';
import type { Batch, Design, Job } from '@acs/types';
import { api } from '../lib/api';
import { builtinUrl } from '../lib/builtins';
import { plural } from '../lib/format';
import { useCards, useJobs, useProject } from '../lib/queries';
import type { AssetX, CardBundle, CardX } from '../lib/types';
import { Badge, Button, cx, Dialog, Empty, Spinner, Textarea } from '../ui';
import { Thumb } from '../components/Thumb';
import { LazyListingPreview } from '../listing';
import { FitWidth } from '../listing/ListingMock';
import { pickProvider, planLabel, useConnections } from '../editor/ai/useAi';

type GenJob = Omit<Job, 'input'> & { request: string; prompt: string; assetIds: string[] };
interface Run { batch: Batch; jobs: GenJob[] }
interface Img { job: GenJob; asset: AssetX; earlier: boolean }
type Choice = { kind: 'updated'; assetId: string } | { kind: 'previous' };

const LIVE = ['queued', 'preparing', 'running'];
const isLive = (j: GenJob) => LIVE.includes(j.status);
const DAY = 24 * 3600_000;

/** The user request line of a composed prompt: what this card's image was asked to show. */
function requestLine(j: GenJob) {
  const m = j.prompt.match(/USER REQUEST\n([\s\S]*)$/);
  return (m?.[1] ?? j.request).trim();
}

/** "0:42" since a job started, ticking, so a running job never looks frozen. */
function Elapsed({ since }: { since: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!since) return null;
  const s = Math.max(0, Math.round((now - Date.parse(since)) / 1000));
  return <span className="tabular-nums">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}

/** One of the two ways to describe the new photos: a ringed card with a radio dot. */
function PromptMode({ selected, onSelect, title, children, testId }: { selected: boolean; onSelect: () => void; title: string; children: ReactNode; testId: string }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect} data-testid={testId}
      className={cx('press flex flex-col items-start gap-1.5 rounded-xl border bg-panel p-4 text-left', selected ? 'border-ink shadow-[0_0_0_1px_#111]' : 'border-line hover:border-line-strong')}>
      <span className="flex items-center gap-2 text-[14px] font-semibold">
        <span className={cx('flex size-4 items-center justify-center rounded-full border', selected ? 'border-ink bg-ink text-white' : 'border-line-strong bg-panel')}>{selected ? <Check className="size-2.5" strokeWidth={3} /> : null}</span>
        {title}
      </span>
      <span className="pl-6 text-[13px] leading-relaxed text-muted">{children}</span>
    </button>
  );
}

/** Where "Generate" lands: which cards to change and how the new photos are described, then it starts. */
export function GenerateStartPage() {
  const { pid = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: proj } = useProject(pid);
  const { data: cards, isLoading } = useCards(pid);
  const { data: conns, isLoading: connsLoading } = useConnections();
  const provider = pickProvider(conns, proj?.project.provider ?? 'auto', 'imageGeneration');
  const [selected, setSelected] = useState<string[]>(() => params.get('cards')?.split(',').filter(Boolean) ?? []);
  const [mode, setMode] = useState<'brief' | 'prompt'>('brief');
  const [prompt, setPrompt] = useState('');
  const list = (cards ?? []).filter((c) => c.status !== 'archived');
  const chosen = list.filter((c) => selected.includes(c.id));
  const aspect = (proj?.project.width ?? 1600) / (proj?.project.height ?? 1000);
  const minutes = Math.max(1, Math.round(chosen.length * 1.2));
  const brief = proj?.project.brief?.trim() ?? '';
  const text = prompt.trim();
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const start = useMutation({
    mutationFn: () => api.post<{ batchId: string | null }>('/ai/generate', {
      projectId: pid, cardIds: chosen.map((c) => c.id), prompt: mode === 'prompt' ? text : '', variations: 1, mode: 'generate', provider: provider!.provider, autoUse: false, review: true,
    }),
    onSuccess: (r) => {
      if (!r.batchId) { toast.error('Generation could not start. Try again.'); return; }
      void qc.invalidateQueries({ queryKey: ['jobs', pid] });
      navigate(`/p/${pid}/generate/${r.batchId}`, { replace: true });
    },
    onError: (e) => toast.error(e.message),
  });
  const blocker = !provider ? '' : !chosen.length ? 'Choose the cards to change' : mode === 'prompt' && !text ? 'Write the prompt' : '';

  return (
    <div className="mx-auto max-w-[1180px] px-8 pb-24">
      <div className="pt-6">
        <Link to={`/p/${pid}`} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"><ArrowLeft className="size-3.5" /> {proj?.project.name ?? 'Project'}</Link>
      </div>
      <header className="flex items-end justify-between gap-4 pt-2 pb-5">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-tight">Generate new backgrounds</h1>
          <div className="mt-1 text-[13px] text-muted">{chosen.length} of {plural(list.length, 'card')} chosen{provider ? ` · ${planLabel(provider)}` : ''}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button onClick={() => navigate(`/p/${pid}`)}>Cancel</Button>
          <Button variant="primary" icon={<Sparkles className="size-3.5" />} loading={start.isPending} disabled={!provider || !!blocker} title={blocker || undefined} onClick={() => start.mutate()} data-testid="gen-start">
            {chosen.length ? `Generate ${plural(chosen.length, 'background')}` : 'Generate'}
          </Button>
        </div>
      </header>

      {!provider && !connsLoading ? (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-[#ecd9b3] bg-warn-bg px-3.5 py-2.5 text-[13px] text-[#7a4f10]">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="flex-1">No AI that can make images is connected. Connect ChatGPT, then come back to generate.</span>
          <Link to="/connections"><Button size="sm">Open AI Connections</Button></Link>
        </div>
      ) : null}

      <div className="mb-2 text-[13px] font-semibold">How should the new photos be described?</div>
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="How the new photos are described">
        <PromptMode selected={mode === 'brief'} onSelect={() => setMode('brief')} title="Follow my brief" testId="gen-mode-brief">
          {brief ? <>Each photo follows the brief you set for this project, shaped by the card’s own page: <span className="text-ink/80">“{brief.length > 150 ? `${brief.slice(0, 150)}…` : brief}”</span></> : 'Each photo is described from the card’s own page.'}
        </PromptMode>
        <PromptMode selected={mode === 'prompt'} onSelect={() => setMode('prompt')} title="Write my own prompt" testId="gen-mode-prompt">
          You describe the photo you want. The same prompt is used for every card you choose.
        </PromptMode>
      </div>
      {mode === 'prompt' ? (
        <div className="mt-3">
          <Textarea rows={3} autoFocus value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={1500} data-testid="gen-prompt"
            placeholder="e.g. A modern Dubai office at golden hour, warm light, shallow depth of field. No people." />
          <div className="mt-1.5 text-[11.5px] text-muted">Your prompt comes first. The card’s page and your project brief are kept as background, so the photo still fits the card.</div>
        </div>
      ) : null}
      <div className="mt-3 text-[12.5px] text-muted">
        Only the background photo is generated. The heading, text, logo, gradient and layout stay as they are, and nothing changes on a card until you choose Updated on the next screen. About a minute per card{chosen.length ? `, so roughly ${minutes} minute${minutes === 1 ? '' : 's'} in all` : ''}. You can leave the page while it runs.
      </div>

      <div className="mt-7 mb-3 flex items-center justify-between gap-3">
        <div className="text-[13px] font-semibold">Which cards should get a new background?</div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={chosen.length === list.length} onClick={() => setSelected(list.map((c) => c.id))} data-testid="gen-select-all">Select all</Button>
          <Button size="sm" variant="ghost" disabled={!chosen.length} onClick={() => setSelected([])}>Clear</Button>
        </div>
      </div>
      {isLoading ? <div className="flex justify-center py-16"><Spinner /></div> : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {list.map((c) => {
            const on = selected.includes(c.id);
            return (
              <button key={c.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(c.id)} data-testid={`gen-card-${c.id}`}
                className={cx('press relative overflow-hidden rounded-xl border bg-panel text-left', on ? 'border-ink shadow-[0_0_0_1px_#111]' : 'border-line hover:border-line-strong')}>
                <Thumb src={c.thumbUrl} aspect={aspect} pending={!c.thumbUrl && c.status !== 'needs_image'} alt={c.name} />
                <span className={cx('absolute top-2 left-2 flex size-5 items-center justify-center rounded-md border', on ? 'border-ink bg-ink text-white' : 'border-white/90 bg-white/80 text-transparent')}><Check className="size-3.5" strokeWidth={3} /></span>
                <div className="truncate px-3 py-2.5 text-[13px] font-medium" title={c.name}>{c.name}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function GenerateReviewPage() {
  const { pid = '', bid = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: proj } = useProject(pid);
  const { data: cards } = useCards(pid);
  const { data: conns } = useConnections();
  const { data: jobsView } = useJobs(pid);
  const provider = pickProvider(conns, proj?.project.provider ?? 'auto', 'imageGeneration');
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [finishing, setFinishing] = useState(false);
  const [stopping, setStopping] = useState(false);

  const run = useQuery({
    queryKey: ['generation', bid],
    queryFn: () => api.get<Run>(`/batches/${bid}/generation`),
    refetchInterval: (q) => (q.state.data?.jobs.some(isLive) ? 2000 : false),
    refetchIntervalInBackground: true,
  });
  const jobs = run.data?.jobs ?? [];

  // earlier runs on this project (last day): their images are offered for the same cards
  const earlierIds = (jobsView?.batches ?? []).filter((b) => b.kind === 'generate' && b.id !== bid && Date.now() - Date.parse(b.createdAt) < DAY).map((b) => b.id);
  const earlierRuns = useQueries({ queries: earlierIds.map((id) => ({ queryKey: ['generation', id], queryFn: () => api.get<Run>(`/batches/${id}/generation`), staleTime: 60_000 })) });
  const earlierJobs = earlierRuns.flatMap((q) => q.data?.jobs ?? []).filter((j) => j.status === 'completed');

  // every image, resolved to URLs; pending ones are re-resolved until ingested
  const allIds = useMemo(() => [...new Set([...earlierJobs, ...jobs].flatMap((j) => j.assetIds))], [jobs, earlierJobs]);
  const assetsQ = useQuery({
    queryKey: ['generation-assets', bid, allIds.join(',')],
    enabled: allIds.length > 0,
    queryFn: () => api.post<AssetX[]>('/assets/resolve', { ids: allIds }),
    refetchInterval: (q) => (q.state.data?.some((a) => a.status === 'pending') ? 2000 : false),
    placeholderData: (prev) => prev,
  });
  const assets = useMemo(() => new Map((assetsQ.data ?? []).map((a) => [a.id, a])), [assetsQ.data]);

  // one row per card, in the order the run started them; retries join their card's row
  const rows = useMemo(() => {
    const byCard = new Map<string, GenJob[]>();
    for (const j of [...jobs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (j.cardId) byCard.set(j.cardId, [...(byCard.get(j.cardId) ?? []), j]);
    }
    const cardMap = new Map((cards ?? []).map((c) => [c.id, c]));
    const imgsOf = (list: GenJob[], earlier: boolean) => list.flatMap((j) => j.assetIds.map((id) => ({ job: j, asset: assets.get(id)!, earlier })))
      .filter((x) => x.asset && x.asset.status === 'ready');
    return [...byCard.entries()].map(([cardId, list]) => {
      const card = cardMap.get(cardId);
      const older = earlierJobs.filter((j) => j.cardId === cardId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const images: Img[] = [...imgsOf(older, true), ...imgsOf(list, false)];
      const applied = images.find((x) => x.asset.id === card?.backgroundAssetId) ?? null;
      return { cardId, card, jobs: list, latest: list[list.length - 1], images, applied };
    });
  }, [jobs, earlierJobs, cards, assets]);
  type RowT = (typeof rows)[number];

  const stoppable = jobs.some((j) => isLive(j) || j.status === 'paused');
  const made = rows.filter((r) => r.images.some((x) => !x.earlier)).length;
  const cancelRun = useMutation({
    mutationFn: () => api.post<{ cancelled: number }>(`/batches/${bid}/cancel`, {}),
    onSuccess: async () => {
      setStopping(false);
      await Promise.all([qc.invalidateQueries({ queryKey: ['generation', bid] }), qc.invalidateQueries({ queryKey: ['jobs', pid] })]);
      toast.success(made ? `Stopped. ${plural(made, 'new background')} kept, choose from ${made === 1 ? 'it' : 'them'} below.` : 'Stopped. Nothing was generated.');
    },
    onError: (e) => toast.error(e.message),
  });

  const queued = jobs.filter((j) => j.status === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const cancelled = rows.filter((r) => r.latest.status === 'cancelled').length;
  const done = rows.filter((r) => !isLive(r.latest) && r.latest.status !== 'cancelled').length;
  const total = rows.length || run.data?.batch.total || 0;
  const choiceOf = (r: RowT): Choice | undefined => choices[r.cardId] ?? (r.applied ? { kind: 'updated', assetId: r.applied.asset.id } : undefined);
  const updatedImg = (r: RowT) => {
    const c = choiceOf(r);
    return (c?.kind === 'updated' ? r.images.find((x) => x.asset.id === c.assetId) : undefined) ?? r.images[r.images.length - 1];
  };
  const choose = (cardId: string, c: Choice) => setChoices((m) => ({ ...m, [cardId]: c }));
  const choosable = rows.filter((r) => r.images.length && !r.applied);
  // the next screen is Export, for the cards of this run (all of them when the run covered the project)
  const toExport = () => {
    const live = (cards ?? []).filter((c) => c.status !== 'archived');
    const ids = rows.map((r) => r.cardId);
    navigate(`/p/${pid}/export${ids.length && ids.length < live.length ? `?cards=${ids.join(',')}` : ''}`);
  };

  const apply = useMutation({
    mutationFn: async () => {
      const picks = choosable.flatMap((r) => {
        const c = choiceOf(r);
        if (c?.kind !== 'updated') return [];
        const img = r.images.find((x) => x.asset.id === c.assetId)!;
        return [{ cardId: r.cardId, assetId: img.asset.id, jobId: img.job.id }];
      });
      for (const p of picks) await api.post(`/projects/${pid}/cards/${p.cardId}/use-generated`, { assetId: p.assetId, jobId: p.jobId });
      return picks.length;
    },
    onSuccess: async (n) => {
      // the project page must see the new versions and their renders straight away, not after a poll
      await Promise.all([qc.invalidateQueries({ queryKey: ['cards', pid] }), qc.invalidateQueries({ queryKey: ['jobs', pid] }), qc.invalidateQueries({ queryKey: ['project', pid] }), qc.invalidateQueries({ queryKey: ['card'] })]);
      toast.success(n ? `${plural(n, 'card')} now ${n === 1 ? 'uses' : 'use'} the new background` : 'Every card keeps its previous image');
      toExport();
    },
    onError: (e) => toast.error(e.message),
  });

  if (run.error) {
    return (
      <div className="mx-auto max-w-[1180px] px-8 pt-16">
        <Empty icon={<AlertTriangle className="size-7 text-warn" />} title="This generation run wasn't found" action={<Link to={`/p/${pid}`}><Button>Back to the project</Button></Link>}>
          {(run.error as Error).message}
        </Empty>
      </div>
    );
  }

  const running = rows.find((r) => r.latest.status === 'running' || r.latest.status === 'preparing');
  return (
    <div className="mx-auto max-w-[1180px] px-8 pb-24">
      <div className="pt-6">
        <Link to={`/p/${pid}`} className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"><ArrowLeft className="size-3.5" /> {proj?.project.name ?? 'Project'}</Link>
      </div>
      <header className="flex items-end justify-between gap-4 pt-2 pb-4">
        <div className="min-w-0">
          <h1 className="text-[24px] font-semibold tracking-tight">New backgrounds</h1>
          <div className="mt-1 text-[13px] text-muted">
            {plural(total, 'card')}{provider ? ` · ${planLabel(provider)}` : ''} · Only the background photo is generated; text, logo and layout stay the same. Pick Previous or Updated for each card, then press Done.
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {stoppable ? <Button icon={<Ban className="size-3.5" />} onClick={() => setStopping(true)} data-testid="gen-cancel">Cancel generating</Button> : null}
          <Button disabled={!choosable.length} onClick={() => setChoices((m) => {
            const n = { ...m };
            for (const r of choosable) n[r.cardId] = { kind: 'updated', assetId: r.images[r.images.length - 1].asset.id };
            return n;
          })}>Choose all updated</Button>
          <Button variant="primary" onClick={() => (choosable.length || rows.some((r) => isLive(r.latest)) ? setFinishing(true) : toExport())} data-testid="gen-done">Done</Button>
        </div>
      </header>

      <div className="mb-5 flex items-center gap-3 text-[12.5px] text-muted">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover">
          <div className="h-full rounded-full bg-ink transition-[width] duration-500 ease-out" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
        <span className="tabular-nums">
          {run.isLoading ? 'Starting…' : done + cancelled < total ? (running
            ? <>Generating background {Math.min(done + 1, total)} of {total}: <span className="text-ink">{running.card?.name ?? 'card'}</span> · <Elapsed since={running.latest.startedAt} /> · about 1–2 minutes each</>
            : <>{done} of {total} done · waiting for the companion to start the next one</>)
            : cancelled ? `Cancelled · ${done} of ${total} backgrounds made`
              : `All ${total} backgrounds ready`}
        </span>
      </div>

      {run.isLoading ? <div className="flex justify-center py-16"><Spinner /></div> : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <Row key={r.cardId} pid={pid} bid={bid} card={r.card} cardId={r.cardId} jobs={r.jobs} latest={r.latest}
              aspect={(proj?.project.width ?? 1600) / (proj?.project.height ?? 1000)}
              images={r.images} updated={updatedImg(r)} choice={choiceOf(r)} applied={!!r.applied}
              position={queued.findIndex((q) => q.id === r.latest.id)}
              onChoose={(c) => choose(r.cardId, c)}
              onRetried={() => { void qc.invalidateQueries({ queryKey: ['generation', bid] }); }} />
          ))}
        </div>
      )}

      <Dialog open={stopping} onOpenChange={setStopping} width={440} title="Stop generating?"
        description={made ? `${plural(made, 'new background')} ${made === 1 ? 'is' : 'are'} ready and stay${made === 1 ? 's' : ''} here to choose from. The ones still waiting won’t be made.` : 'Nothing is ready yet. The backgrounds still waiting won’t be made.'}
        footer={<><Button onClick={() => setStopping(false)}>Keep generating</Button><Button variant="primary" loading={cancelRun.isPending} onClick={() => cancelRun.mutate()} data-testid="gen-cancel-confirm">Stop generating</Button></>}>
        <div className="text-[13px] text-muted">The photo being made right now is dropped. You can generate again for any card afterwards.</div>
      </Dialog>

      {finishing ? (
        <FinishDialog rows={rows.filter((r) => r.images.length || isLive(r.latest))} aspect={(proj?.project.width ?? 1600) / (proj?.project.height ?? 1000)}
          pid={pid} choiceOf={choiceOf} updatedImg={updatedImg} onChoose={choose} busy={apply.isPending}
          onClose={() => setFinishing(false)} onApply={() => apply.mutate()} />
      ) : null}
    </div>
  );
}

/** A card design with one image as its background, drawn like the shipped card. */
function useCardDesign(pid: string, cardId: string, img: Img | undefined, enabled: boolean) {
  const { data: bundle } = useQuery({
    queryKey: ['card', cardId], enabled, refetchOnWindowFocus: false,
    queryFn: () => api.get<CardBundle>(`/projects/${pid}/cards/${cardId}`),
  });
  const resolve = useMemo(() => {
    const known = new Map((bundle?.assets ?? []).map((a) => [a.id, a]));
    if (img) known.set(img.asset.id, img.asset);
    return (ref: string) => {
      if (ref.startsWith('builtin:')) return builtinUrl(ref);
      const a = known.get(ref);
      return a ? (a.width > 2000 ? a.previewUrl : a.url) ?? a.url : null;
    };
  }, [bundle, img]);
  const design: Design | null = bundle && img ? replaceBackground(bundle.design, img.asset.id, 'generated') : null;
  return { bundle, design, resolve };
}

/** One of the two options: a picture with a label, selected with a ring and a tick. */
function Option({ label, selected, onSelect, disabled, children, width, aspect, testId }: {
  label: ReactNode; selected: boolean; onSelect: () => void; disabled?: boolean; children: ReactNode; width: number; aspect: number; testId?: string;
}) {
  return (
    <button type="button" role="radio" aria-checked={selected} disabled={disabled} onClick={onSelect} data-testid={testId}
      className={cx('press group flex flex-col gap-1.5 rounded-lg p-1.5 text-left disabled:cursor-default', selected ? 'bg-[#f1f3ff]' : 'hover:bg-hover disabled:hover:bg-transparent')}>
      <span className="flex items-center gap-1.5 text-[12px] font-medium">
        <span className={cx('flex size-4 items-center justify-center rounded-full border', selected ? 'border-ink bg-ink text-white' : 'border-line-strong bg-panel')}>{selected ? <Check className="size-2.5" strokeWidth={3} /> : null}</span>
        {label}
      </span>
      <span className={cx('relative block overflow-hidden rounded-md border-2', selected ? 'border-ink' : 'border-transparent')} style={{ width, aspectRatio: String(aspect) }}>
        {children}
      </span>
    </button>
  );
}

function UpdatedPicture({ design, resolve, latest }: { design: Design | null; resolve: (r: string) => string | null; latest: GenJob }) {
  if (design) return <FitWidth width={design.canvas.width}><CardScene design={design} resolveSrc={resolve} /></FitWidth>;
  if (latest.status === 'failed') return <span className="absolute inset-0 flex items-center justify-center bg-hover p-3 text-center text-[12px] text-err">{latest.error ?? 'Generation failed.'}</span>;
  if (latest.status === 'cancelled') return <span className="absolute inset-0 flex items-center justify-center bg-hover p-3 text-center text-[12px] text-muted">Cancelled. Nothing was generated.</span>;
  if (latest.status === 'paused') return <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-hover p-3 text-center text-[12px] text-warn"><PauseCircle className="size-4" />Provider usage limit. It resumes on its own.</span>;
  return (
    <span className="skeleton absolute inset-0 flex items-center justify-center">
      <span className="flex items-center gap-1.5 rounded-full bg-white/85 px-2.5 py-1 text-[11.5px] text-muted">
        <Loader2 className="size-3 animate-spin" />{latest.status === 'queued' ? 'Waiting' : <>Generating · <Elapsed since={latest.startedAt} /></>}
      </span>
    </span>
  );
}

function Row({ pid, bid, card, cardId, jobs, latest, aspect, images, updated, choice, applied, position, onChoose, onRetried }: {
  pid: string; bid: string; card: CardX | undefined; cardId: string; jobs: GenJob[]; latest: GenJob; aspect: number;
  images: Img[]; updated: Img | undefined; choice: Choice | undefined; applied: boolean; position: number;
  onChoose: (c: Choice) => void; onRetried: () => void;
}) {
  const [retry, setRetry] = useState(false);
  const [note, setNote] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const [site, setSite] = useState(false);
  const live = isLive(latest);
  const { bundle, design, resolve } = useCardDesign(pid, cardId, updated, !!updated || site);

  const again = useMutation({
    mutationFn: () => api.post('/ai/generate', { projectId: pid, cardIds: [cardId], prompt: note.trim(), variations: 1, mode: 'generate', autoUse: false, batchId: bid }),
    onSuccess: () => { setRetry(false); setNote(''); onRetried(); toast.success(`Generating another background for ${card?.name ?? 'this card'}`); },
    onError: (e) => toast.error(e.message),
  });

  const status = applied ? <Badge tone="ok"><Check className="mr-0.5 inline size-3" />Updated</Badge>
    : choice?.kind === 'updated' ? <Badge tone="info">Updated chosen</Badge>
      : choice?.kind === 'previous' ? <Badge>Previous chosen</Badge>
        : latest.status === 'failed' && !images.length ? <Badge tone="err">Failed</Badge>
          : latest.status === 'paused' ? <Badge tone="warn">Paused</Badge>
            : latest.status === 'cancelled' && !images.length ? <Badge>Cancelled</Badge>
            : live && !images.length ? <Badge tone="info">{latest.status === 'queued' ? (position > 0 ? `In line · ${position + 1}` : 'Next up') : 'Generating'}</Badge>
              : images.length ? <Badge tone="warn">Choose one</Badge> : <Badge>Waiting for image</Badge>;

  const W = 240;
  return (
    <section className="rounded-xl border border-line bg-panel" data-testid={`gen-row-${cardId}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-3 p-4 lg:grid-cols-[190px_auto_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold" title={card?.name}>{card?.name ?? cardId}</div>
          <div className="mt-1.5">{status}</div>
          {jobs.length > 1 || images.some((x) => x.earlier) ? <div className="mt-1.5 text-[11.5px] text-muted">{plural(images.length, 'new image')}</div> : null}
        </div>

        <div className="row-span-2 flex items-start gap-2 self-start lg:row-span-1" role="radiogroup" aria-label={`Image for ${card?.name ?? 'this card'}`}>
          <Option label="Previous" width={W} aspect={aspect} selected={choice?.kind === 'previous'} disabled={applied} onSelect={() => onChoose({ kind: 'previous' })} testId={`pick-previous-${cardId}`}>
            <Thumb src={card?.thumbUrl} aspect={aspect} />
          </Option>
          <Option label={applied ? 'Updated · applied' : 'Updated'} width={W} aspect={aspect} selected={choice?.kind === 'updated'} disabled={!updated || applied}
            onSelect={() => updated && onChoose({ kind: 'updated', assetId: updated.asset.id })} testId={`pick-updated-${cardId}`}>
            <UpdatedPicture design={design} resolve={resolve} latest={latest} />
          </Option>
        </div>

        <div className="col-span-2 flex min-w-0 flex-col gap-2.5 lg:col-span-1">
          {images.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11.5px] text-muted">New images</span>
              {images.map((x, i) => (
                <button key={x.asset.id} onClick={() => onChoose({ kind: 'updated', assetId: x.asset.id })} aria-pressed={updated?.asset.id === x.asset.id}
                  title={x.earlier ? `From an earlier run (${i + 1})` : `Image ${i + 1}`} disabled={applied}
                  className={cx('press relative h-9 w-14 overflow-hidden rounded border', updated?.asset.id === x.asset.id ? 'border-ink shadow-[0_0_0_1px_#111]' : 'border-line hover:border-line-strong')}>
                  <img src={x.asset.thumbUrl ?? x.asset.url ?? ''} alt="" className="size-full object-cover" />
                  {x.earlier ? <span className="absolute right-0 bottom-0 left-0 bg-black/55 text-center text-[9px] leading-3 text-white">earlier</span> : null}
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-1.5">
            {applied ? <Link to={`/p/${pid}/c/${cardId}`}><Button size="sm">Open card</Button></Link> : null}
            {!live ? <Button size="sm" variant="ghost" icon={latest.status === 'failed' ? <RefreshCw className="size-3.5" /> : <RotateCcw className="size-3.5" />} onClick={() => setRetry((v) => !v)}>{latest.status === 'failed' ? 'Retry' : latest.status === 'cancelled' && !images.length ? 'Generate' : 'Try again'}</Button> : null}
            {updated ? <Button size="sm" variant={site ? 'subtle' : 'ghost'} icon={<MonitorSmartphone className="size-3.5" />} aria-pressed={site} onClick={() => setSite((v) => !v)}>On arnifi.com</Button> : null}
          </div>

          {retry ? (
            <div className="flex flex-col gap-2 rounded-lg bg-canvas p-2.5">
              <Textarea rows={2} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change? e.g. a closer view of the certificate, warmer light" />
              <div className="text-[11.5px] text-muted">Optional. Leave it empty to try again with the same prompt.</div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="primary" icon={<Sparkles className="size-3.5" />} loading={again.isPending} onClick={() => again.mutate()}>Generate another</Button>
                <Button size="sm" variant="ghost" onClick={() => setRetry(false)}>Cancel</Button>
              </div>
            </div>
          ) : null}

          <button className="flex max-w-full items-start gap-1 text-left text-[12px] text-muted hover:text-ink" onClick={() => setShowPrompt((v) => !v)} aria-expanded={showPrompt}>
            <ChevronDown className={cx('mt-0.5 size-3.5 shrink-0 transition-transform duration-150', showPrompt ? 'rotate-180' : '-rotate-90')} />
            <span className="min-w-0"><span className="font-medium text-ink/80">Prompt</span> · {requestLine(latest) || 'written from the page and brief'}{showPrompt ? '' : ' (show the full prompt)'}</span>
          </button>
          {showPrompt ? <pre className="max-h-56 overflow-auto rounded-md bg-hover p-3 text-[11.5px] leading-relaxed whitespace-pre-wrap scroll-quiet">{latest.prompt || 'The prompt is written when the job starts.'}</pre> : null}
        </div>
      </div>

      {site && design && bundle ? (
        <div className="border-t border-line p-4">
          <LazyListingPreview title={card?.name} items={[
            { key: 'new', label: 'Updated', thumb: updated?.asset.thumbUrl, media: { kind: 'design', design, resolveSrc: resolve, photo: updated?.asset.width ? { width: updated.asset.width, height: updated.asset.height } : null } },
            { key: 'now', label: 'Previous', thumb: card?.thumbUrl, media: { kind: 'design', design: bundle.design, resolveSrc: resolve } },
          ]} />
        </div>
      ) : null}
    </section>
  );
}

interface FinishRow { cardId: string; card: CardX | undefined; latest: GenJob; images: Img[]; applied: Img | null }

/** "Done": the two options for every card, one last time, then apply. */
function FinishDialog({ rows, aspect, pid, choiceOf, updatedImg, onChoose, busy, onClose, onApply }: {
  rows: FinishRow[]; aspect: number; pid: string;
  choiceOf: (r: FinishRow & { jobs: GenJob[] }) => Choice | undefined; updatedImg: (r: FinishRow & { jobs: GenJob[] }) => Img | undefined;
  onChoose: (cardId: string, c: Choice) => void; busy: boolean; onClose: () => void; onApply: () => void;
}) {
  const ready = rows.filter((r) => r.images.length && !r.applied) as (FinishRow & { jobs: GenJob[] })[];
  const pending = rows.filter((r) => !r.images.length && isLive(r.latest));
  const updatedCount = ready.filter((r) => choiceOf(r)?.kind === 'updated').length;
  const open = ready.filter((r) => !choiceOf(r)).length;
  const W = 210;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} width={720} title="Choose the image for each card"
      description="Updated uses the new background. Previous keeps the card exactly as it is. Next comes Export."
      footer={(
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => ready.forEach((r) => onChoose(r.cardId, { kind: 'previous' }))}>Keep all previous</Button>
          <Button onClick={() => ready.forEach((r) => onChoose(r.cardId, { kind: 'updated', assetId: (updatedImg(r) ?? r.images[r.images.length - 1]).asset.id }))}>All updated</Button>
          <Button variant="primary" loading={busy} onClick={onApply} data-testid="gen-apply">
            {updatedCount ? `Use ${plural(updatedCount, 'new background')} and continue` : 'Keep previous and continue'}
          </Button>
        </>
      )}>
      <div className="flex max-h-[58vh] flex-col gap-3 overflow-y-auto pr-1 scroll-quiet">
        {open ? <div className="rounded-md bg-warn-bg px-3 py-2 text-[12.5px] text-warn">{plural(open, 'card')} not chosen yet: {open === 1 ? 'it keeps' : 'they keep'} the previous image unless you pick Updated.</div> : null}
        {ready.map((r) => <FinishItem key={r.cardId} pid={pid} r={r} aspect={aspect} W={W} choice={choiceOf(r)} updated={updatedImg(r)} onChoose={(c) => onChoose(r.cardId, c)} />)}
        {pending.length ? (
          <div className="rounded-md border border-dashed border-line-strong px-3 py-2.5 text-[12.5px] text-muted">
            Still generating: {pending.map((r) => r.card?.name ?? r.cardId).join(', ')}. When {pending.length === 1 ? 'it’s' : 'they’re'} ready, choose from the “New backgrounds · Review” link on the project page.
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function FinishItem({ pid, r, aspect, W, choice, updated, onChoose }: { pid: string; r: FinishRow; aspect: number; W: number; choice: Choice | undefined; updated: Img | undefined; onChoose: (c: Choice) => void }) {
  const { design, resolve } = useCardDesign(pid, r.cardId, updated, true);
  return (
    <div className="flex items-start gap-4 border-b border-line pb-3 last:border-0" data-testid={`finish-${r.cardId}`}>
      <div className="w-[160px] min-w-0 pt-1.5 text-[13px] font-medium"><span className="line-clamp-2">{r.card?.name ?? r.cardId}</span></div>
      <div className="flex gap-2" role="radiogroup" aria-label={`Image for ${r.card?.name ?? 'this card'}`}>
        <Option label="Previous" width={W} aspect={aspect} selected={choice?.kind === 'previous'} onSelect={() => onChoose({ kind: 'previous' })}>
          <Thumb src={r.card?.thumbUrl} aspect={aspect} />
        </Option>
        <Option label="Updated" width={W} aspect={aspect} selected={choice?.kind === 'updated'} onSelect={() => updated && onChoose({ kind: 'updated', assetId: updated.asset.id })}>
          <UpdatedPicture design={design} resolve={resolve} latest={r.latest} />
        </Option>
      </div>
    </div>
  );
}
