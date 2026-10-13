/** Workspace pieces: the batch toolbar and the job strip. */
import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ChevronDown, Download, Eye, EyeOff, Image as ImageIcon, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import type { BatchAction, BatchBody, Project } from '@acs/types';
import { api } from '../lib/api';
import { plural } from '../lib/format';
import { useJobs } from '../lib/queries';
import type { AssetX } from '../lib/types';
import { Badge, Button, Menu, MenuItem } from '../ui';
import { AssetPicker } from './AssetPicker';

export function useBatch(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: BatchBody) => api.post<{ changed: number; skippedApproved: number }>(`/projects/${pid}/batch`, b),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['cards', pid] });
      qc.invalidateQueries({ queryKey: ['jobs', pid] });
      qc.invalidateQueries({ queryKey: ['project', pid] });
      toast.success(`${plural(r.changed, 'card')} updated`);
    },
    onError: (e) => toast.error(e.message),
  });
}

/** "14 selected": the few things you do to many cards at once. */
export function BatchBar({ project, selected, onClear, onGenerate, onDownload }: { project: Project; selected: string[]; onClear: () => void; onGenerate: () => void; onDownload: () => void }) {
  const batch = useBatch(project.id);
  const [picking, setPicking] = useState(false);
  const run = (op: BatchAction) => batch.mutate({ cardIds: selected, scope: 'selected', op });

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-line bg-panel p-1.5 shadow-[var(--shadow-pop)]">
        <span className="px-2.5 text-[13px] font-medium tabular-nums">{selected.length} selected</span>
        <div className="mx-1 h-5 w-px bg-line" />
        <Button size="sm" variant="ghost" icon={<Sparkles className="size-3.5" />} onClick={onGenerate}>Generate</Button>
        <Button size="sm" variant="ghost" icon={<ImageIcon className="size-3.5" />} onClick={() => setPicking(true)}>Replace background</Button>
        <Menu align="center" trigger={<Button size="sm" variant="ghost">First line<ChevronDown className="size-3 text-muted" /></Button>}>
          <MenuItem icon={<EyeOff className="size-3.5" />} onSelect={() => run({ action: 'toggle_layer', layerId: 'subheading', visible: false })}>Hide the first line</MenuItem>
          <MenuItem icon={<Eye className="size-3.5" />} onSelect={() => run({ action: 'toggle_layer', layerId: 'subheading', visible: true })}>Show the first line</MenuItem>
        </Menu>
        <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={onDownload}>Export</Button>
        {batch.isPending ? <Loader2 className="mx-1 size-4 animate-spin text-muted" /> : null}
        <button onClick={onClear} className="press ml-0.5 rounded-md p-1.5 text-muted hoverable" aria-label="Clear selection"><X className="size-4" /></button>
      </div>

      {picking ? <AssetPicker open onOpenChange={setPicking} projectId={project.id} title={`Background for ${plural(selected.length, 'card')}`}
        onPick={(a: AssetX) => { run({ action: 'replace_background', assetId: a.id }); setPicking(false); }} /> : null}
    </div>
  );
}

/** Live job status (PRD §64): progress while anything runs, retry for what failed. */
export function JobsStrip({ pid }: { pid: string }) {
  const { data } = useJobs(pid);
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: async (ids: string[]) => { for (const id of ids) await api.post(`/jobs/${id}/retry`); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs', pid] }),
    onError: (e) => toast.error(e.message),
  });
  if (!data) return null;
  const active = data.jobs.filter((j) => ['queued', 'preparing', 'running'].includes(j.status));
  const recent = data.jobs.filter((j) => Date.now() - Date.parse(j.createdAt) < 6 * 3600_000);
  const failed = recent.filter((j) => j.status === 'failed');
  const paused = data.jobs.filter((j) => j.status === 'paused');
  const reasons = [...new Set(failed.map((j) => j.error).filter((e): e is string => !!e))];
  // the latest background run stays one click away: its new backgrounds wait there to be picked
  const gen = data.batches.find((b) => b.kind === 'generate' && Date.now() - Date.parse(b.createdAt) < 24 * 3600_000);
  if (!active.length && !failed.length && !paused.length && !gen) return null;
  const settled = gen ? gen.completed + gen.failed + (gen.cancelled ?? 0) : 0;
  const by = (t: string) => active.filter((j) => j.type === t).length;
  const label = [by('render') && `Rendering ${plural(by('render'), 'card')}`, by('ingest') && `Downloading ${plural(by('ingest'), 'image')}`,
    by('export') && 'Exporting', active.some((j) => j.type.startsWith('ai.')) && 'AI working'].filter(Boolean).join(' · ');
  return (
    <div className="mx-8 mb-4 flex items-center gap-3 rounded-lg border border-line bg-panel px-3.5 py-2 text-[13px]">
      {active.length ? <><Loader2 className="size-3.5 animate-spin text-muted" /><span>{label || `${active.length} jobs running`}</span></> : null}
      {paused.length ? <Badge tone="warn">{plural(paused.length, 'job')} paused: provider usage limit</Badge> : null}
      {gen ? (
        <Link to={`/p/${pid}/generate/${gen.id}`} className="inline-flex items-center gap-1.5 font-medium hover:underline">
          <Sparkles className="size-3.5" />New backgrounds{gen.status === 'cancelled' ? ` · Cancelled · ${gen.completed} of ${gen.total} made` : settled < gen.total ? ` · ${settled} of ${gen.total} done` : ''} · Review
        </Link>
      ) : null}
      {failed.length ? (
        <span className="ml-auto flex items-center gap-2 text-err">
          <AlertTriangle className="size-3.5" />{failed.length} failed
          {reasons.length ? <span className="max-w-[28rem] truncate text-muted" title={reasons.join('\n')}>· {reasons.length === 1 ? reasons[0] : `${reasons.length} different reasons`}</span> : null}
          <Button size="sm" icon={<RefreshCw className="size-3" />} loading={retry.isPending} onClick={() => retry.mutate(failed.map((f) => f.id))}>Retry {failed.length} Failed</Button>
        </span>
      ) : null}
    </div>
  );
}
