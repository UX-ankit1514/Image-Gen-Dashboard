/**
 * Background generation (PRD §33–34, §43, §88): the user writes only the instruction; project brief,
 * page context, references and rejection history are added automatically. Results never overwrite
 * anything: "Use" makes a new version. Disabled, with alternatives, when no connected provider can
 * generate images (capability flag imageGeneration = false).
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bookmark, Check, ImageOff, Loader2, MonitorSmartphone, Pencil, RefreshCw, Sparkles } from 'lucide-react';
import { replaceBackground } from '@acs/renderer';
import type { Job } from '@acs/types';
import { api } from '../../lib/api';
import { plural } from '../../lib/format';
import { useProject } from '../../lib/queries';
import type { AssetX, CardBundle } from '../../lib/types';
import { builtinUrl } from '../../lib/builtins';
import { LazyListingPreview, type PreviewItem } from '../../listing';
import { useEditor } from '../store';
import { Badge, Button, Dialog, Field, Segmented, Textarea } from '../../ui';
import { Thumb } from '../../components/Thumb';
import { pickProvider, planLabel, useConnections, waitForJob } from './useAi';
import { UsageLimitDialog } from './UsageLimitDialog';

interface Run { job: Job; cardId: string; assets: AssetX[] }

export function GenerateDialog({ open, onOpenChange, projectId, cardIds, initialPrompt = '', mode = 'generate', onUsed }: {
  open: boolean; onOpenChange: (v: boolean) => void; projectId: string; cardIds: string[]; initialPrompt?: string; mode?: 'generate' | 'edit'; onUsed?: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: proj } = useProject(projectId);
  const { data: conns } = useConnections();
  const single = cardIds.length === 1;
  const need = mode === 'edit' ? 'imageEditing' : 'imageGeneration';
  const provider = pickProvider(conns, proj?.project.provider ?? 'auto', need);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [count, setCount] = useState<'1' | '2' | '3' | '4'>(single ? '4' : '1');
  const [runs, setRuns] = useState<Run[]>([]);
  const [phase, setPhase] = useState<'form' | 'running' | 'results'>('form');
  const [fullPrompt, setFullPrompt] = useState<string | null>(null);
  const [limit, setLimit] = useState<{ provider: string; resetAt: string | null } | null>(null);
  const [siteFocus, setSiteFocus] = useState<string | undefined>();

  // each variation in this card's design, as "Use" would make it, for the arnifi.com listing preview
  const { data: cardBundle } = useQuery({
    queryKey: ['card', cardIds[0]], enabled: open && single, refetchOnWindowFocus: false,
    queryFn: () => api.get<CardBundle>(`/projects/${projectId}/cards/${cardIds[0]}`),
  });
  const siteItems = useMemo((): PreviewItem[] => {
    if (!single || !cardBundle) return [];
    const live = useEditor.getState();
    const base = live.cardId === cardIds[0] && live.design ? live.design : cardBundle.design;
    const known = new Map(cardBundle.assets.map((a) => [a.id, a]));
    const variations = runs.flatMap((r) => r.assets.map((a, i) => ({ a, i }))).filter(({ a }) => a.status === 'ready' && a.url);
    for (const { a } of variations) known.set(a.id, a);
    const resolveSrc = (ref: string) => {
      if (ref.startsWith('builtin:')) return builtinUrl(ref);
      const a = known.get(ref);
      return a ? (a.width > 2000 ? a.previewUrl : a.url) ?? a.url : null;
    };
    return variations.map(({ a, i }) => ({
      key: a.id, label: `Variation ${i + 1}`, thumb: a.thumbUrl ?? a.url,
      media: { kind: 'design', design: replaceBackground(base, a.id, 'generated'), resolveSrc, photo: a.width ? { width: a.width, height: a.height } : null },
    }));
  }, [single, cardBundle, runs, cardIds]);

  const start = useMutation({
    mutationFn: () => api.post<{ jobs: Job[]; batchId: string | null }>('/ai/generate', {
      projectId, cardIds, prompt, variations: Number(count), mode, provider: provider?.provider, autoUse: !single,
    }),
    onSuccess: async ({ jobs }) => {
      setPhase('running');
      const initial = jobs.map((job) => ({ job, cardId: job.cardId!, assets: [] as AssetX[] }));
      setRuns(initial);
      await Promise.all(initial.map(async (r, i) => {
        // The job reports each variation as the companion uploads it (a few minutes for four), so show
        // them as they land instead of one spinner until all are done. Pending ones are re-resolved
        // until their thumbnails exist.
        let finished = false;
        const seen = { key: '', ready: false, busy: false };
        const showPartial = (ids: string[]) => {
          const key = ids.join(',');
          if (!ids.length || seen.busy || (seen.key === key && seen.ready)) return;
          seen.busy = true;
          api.post<AssetX[]>('/assets/resolve', { ids })
            .then((got) => {
              seen.key = key;
              seen.ready = got.every((a) => a.status !== 'pending');
              if (!finished) setRuns((cur) => cur.map((x, k) => (k === i ? { ...x, assets: got } : x)));
            })
            .catch(() => {})
            .finally(() => { seen.busy = false; });
        };
        const done = await waitForJob(r.job.id, (j) => {
          setRuns((cur) => cur.map((x, k) => (k === i ? { ...x, job: j } : x)));
          showPartial(((j.output as { assetIds?: string[] } | null)?.assetIds) ?? []);
        });
        finished = true;
        let assets: AssetX[] = [];
        const ids = ((done.output as { assetIds?: string[] } | null)?.assetIds) ?? [];
        if (ids.length) assets = await api.post<AssetX[]>('/assets/resolve', { ids });
        if (done.status === 'paused') setLimit({ provider: done.provider ?? 'openai', resetAt: done.resumeAt });
        setRuns((cur) => cur.map((x, k) => (k === i ? { ...x, job: done, assets } : x)));
      }));
      setPhase('results');
      qc.invalidateQueries({ queryKey: ['cards', projectId] });
      qc.invalidateQueries({ queryKey: ['jobs', projectId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const use = useMutation({
    mutationFn: ({ cardId, asset, job }: { cardId: string; asset: AssetX; job: Job }) => api.post(`/projects/${projectId}/cards/${cardId}/use-generated`, { assetId: asset.id, jobId: job.id }),
    onSuccess: () => { toast.success('Used as the background: saved as a new version'); qc.invalidateQueries({ queryKey: ['cards', projectId] }); onUsed?.(); onOpenChange(false); },
    onError: (e) => toast.error(e.message),
  });
  const mark = useMutation({
    mutationFn: ({ asset }: { asset: AssetX }) => api.post(`/assets/${asset.id}/reference`, { projectId, kind: 'style', note: prompt }),
    onSuccess: () => toast.success('Saved as a reference for future generations'),
  });
  const preview = useMutation({
    mutationFn: () => api.post<{ prompt: string }>('/ai/compose', { projectId, cardId: cardIds[0], prompt, mode }),
    onSuccess: (r) => setFullPrompt(r.prompt),
    onError: (e) => toast.error(e.message),
  });

  const failed = runs.filter((r) => r.job.status === 'failed');
  const live = (j: Job) => ['queued', 'preparing', 'running'].includes(j.status);
  // ChatGPT makes one image at a time (~1–2 min each), so say which one is being made
  const progress = (r: Run) => (r.job.status === 'queued' ? 'Waiting for the companion…'
    : single && mode === 'generate' ? `Generating variation ${Math.min(r.assets.length + 1, Number(count))} of ${count}… about 1–2 minutes each. You can use one as soon as it appears.`
      : 'Generating…');

  return (
    <Dialog open={open} onOpenChange={onOpenChange} width={phase === 'form' ? 600 : 960}
      title={mode === 'edit' ? 'Edit background with a prompt' : single ? 'Generate background' : `Generate backgrounds for ${plural(cardIds.length, 'card')}`}
      description={provider ? `${planLabel(provider)} · the brief, page context, references and rejection history are included automatically.` : undefined}
      footer={phase === 'form' ? (
        <>
          <Button onClick={() => preview.mutate()} loading={preview.isPending} disabled={!provider}>View full prompt</Button>
          <Button variant="primary" icon={<Sparkles className="size-3.5" />} disabled={!provider} loading={start.isPending} onClick={() => start.mutate()}>Generate</Button>
        </>
      ) : phase === 'results' ? (
        <>
          {failed.length ? <Button icon={<RefreshCw className="size-3.5" />} onClick={async () => { for (const f of failed) await api.post(`/jobs/${f.job.id}/retry`); setPhase('running'); start.reset(); toast('Retrying failed generations'); }}>Retry {failed.length} failed</Button> : null}
          <Button onClick={() => setPhase('form')} icon={<Pencil className="size-3.5" />}>Edit prompt</Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button>
        </>
      ) : null}>
      {!provider ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <ImageOff className="size-7 text-faint" strokeWidth={1.5} />
          <div className="text-[14px] font-medium">Image {mode === 'edit' ? 'editing' : 'generation'} is unavailable on the connected AI.</div>
          <div className="max-w-md text-[13px] text-muted">Claude does not generate images, and ChatGPT image generation depends on what your plan's connection supports. You can still:</div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => { onOpenChange(false); navigate('/connections'); }}>AI Connections</Button>
            <Button onClick={() => onOpenChange(false)}>Upload an image</Button>
            <Button onClick={() => onOpenChange(false)}>Choose another page image</Button>
            <Button onClick={() => onOpenChange(false)}>Reuse a project asset</Button>
          </div>
        </div>
      ) : phase === 'form' ? (
        <div className="flex flex-col gap-4">
          <Field label="Instruction" hint="Optional. Leave empty to generate from the page and brief alone.">
            <Textarea rows={3} autoFocus value={prompt} onChange={(e) => setPrompt(e.target.value)}
              placeholder={mode === 'edit' ? 'Remove the building; keep the desk and the light.' : 'A premium still life showing an Irish business incorporation document.'} />
          </Field>
          {single && mode === 'generate' ? (
            <Field label="Variations"><Segmented value={count} onChange={setCount} options={['1', '2', '3', '4'].map((v) => ({ value: v as '1', label: v }))} /></Field>
          ) : !single ? <div className="text-[12.5px] text-muted">One new background per card, each saved as a new version. Failures don't stop the rest.</div> : null}
          {fullPrompt ? <pre className="max-h-64 overflow-auto rounded-md bg-hover p-3 text-[11.5px] leading-relaxed whitespace-pre-wrap scroll-quiet">{fullPrompt}</pre> : null}
        </div>
      ) : (
        <div className="flex max-h-[64vh] flex-col gap-4 overflow-auto scroll-quiet">
          {runs.map((r) => (
            <div key={r.job.id}>
              {!single ? <div className="mb-1.5 flex items-center gap-2 text-[12.5px] font-medium">{r.cardId}{r.job.status === 'completed' ? <Badge tone="ok">New version</Badge> : null}</div> : null}
              {(r.job.status === 'completed' || live(r.job)) && r.assets.length ? (
                <>
                <div className="grid grid-cols-2 gap-3">
                  {r.assets.map((a, i) => (
                    <div key={a.id} className="overflow-hidden rounded-lg border border-line">
                      <Thumb src={a.previewUrl ?? a.thumbUrl} pending={a.status === 'pending'} />
                      <div className="flex flex-wrap items-center gap-1 p-2">
                        <span className="mr-auto text-[12px] text-muted">Variation {i + 1}</span>
                        {single ? <Button size="sm" variant="primary" icon={<Check className="size-3" />} loading={use.isPending} onClick={() => use.mutate({ cardId: r.cardId, asset: a, job: r.job })}>Use</Button> : null}
                        <Button size="sm" variant="ghost" icon={<Bookmark className="size-3" />} onClick={() => mark.mutate({ asset: a })}>Save as reference</Button>
                        {siteItems.some((x) => x.key === a.id) ? (
                          <Button size="sm" variant={siteFocus === a.id ? 'subtle' : 'ghost'} icon={<MonitorSmartphone className="size-3" />}
                            onClick={() => { setSiteFocus(a.id); document.getElementById('generate-site-preview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>On arnifi.com</Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                {live(r.job) ? <div className="mt-3 flex items-center gap-2 text-[13px] text-muted"><Loader2 className="size-4 animate-spin" />{progress(r)}</div> : null}
                </>
              ) : r.job.status === 'failed' ? (
                <div className="rounded-lg bg-err-bg px-3 py-2 text-[13px] text-err">{r.job.error ?? 'Generation failed.'}</div>
              ) : r.job.status === 'paused' ? (
                <div className="rounded-lg bg-warn-bg px-3 py-2 text-[13px] text-warn">Paused: provider usage limit. The request is kept and resumes later.</div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-6 text-[13px] text-muted"><Loader2 className="size-4 animate-spin" />{progress(r)}</div>
              )}
            </div>
          ))}
          {single && phase === 'results' ? <Button className="self-start" icon={<RefreshCw className="size-3.5" />} onClick={() => start.mutate()}>Regenerate</Button> : null}
          {siteItems.length ? (
            <div id="generate-site-preview" className="scroll-mt-2">
              <LazyListingPreview items={siteItems} initialKey={siteFocus} title={cardBundle?.card.name} />
            </div>
          ) : null}
        </div>
      )}
      {limit ? <UsageLimitDialog open onOpenChange={() => setLimit(null)} provider={limit.provider} resetAt={limit.resetAt} /> : null}
    </Dialog>
  );
}
