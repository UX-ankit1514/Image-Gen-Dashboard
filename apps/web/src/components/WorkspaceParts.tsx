/** Workspace pieces: batch toolbar (§39), brief & rules (§36–37), job strip (§64), source changes (§57), duplicates (§47), upload mapping (§95). */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ChevronDown, Copy, Eye, EyeOff, Image as ImageIcon, LayoutTemplate, Loader2, Maximize2, Palette, RefreshCw, Sparkles, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react';
import type { BatchAction, BatchBody, Project, RejectTag, Scope, SourceChange, Suggestion } from '@acs/types';
import { api } from '../lib/api';
import { plural } from '../lib/format';
import { useBootstrap, useJobs } from '../lib/queries';
import type { AssetX, CardX } from '../lib/types';
import { Badge, Button, Checkbox, Dialog, Field, Input, Menu, MenuItem, MenuSeparator, Textarea } from '../ui';
import { AssetPicker } from './AssetPicker';
import { ExportDialog } from './ExportDialog';
import { RejectDialog } from './RejectDialog';
import { ResizeDialog } from './ResizeDialog';
import { TemplateDialog } from './TemplateDialog';

export function useBatch(pid: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: BatchBody) => api.post<{ changed: number; skippedApproved: number }>(`/projects/${pid}/batch`, b),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['cards', pid] });
      qc.invalidateQueries({ queryKey: ['jobs', pid] });
      qc.invalidateQueries({ queryKey: ['project', pid] });
      toast.success(`${plural(r.changed, 'card')} updated${r.skippedApproved ? ` · ${r.skippedApproved} approved left as they are` : ''}`);
    },
    onError: (e) => toast.error(e.message),
  });
}

/** "14 selected" toolbar. Each change makes a version per card; approved cards only if included. */
export function BatchBar({ project, selected, cards, onClear, onGenerate }: { project: Project; selected: string[]; cards: CardX[]; onClear: () => void; onGenerate: () => void }) {
  const { data: boot } = useBootstrap();
  const batch = useBatch(project.id);
  const [scope, setScope] = useState<Scope>('selected');
  const [includeApproved, setIncludeApproved] = useState(false);
  const [dialog, setDialog] = useState<null | 'resize' | 'template' | 'reject' | 'export' | 'background'>(null);
  const approvedCount = cards.filter((c) => selected.includes(c.id) && (c.status === 'approved' || c.status === 'exported')).length;
  const run = (op: BatchAction) => batch.mutate({ cardIds: selected, scope, includeApproved, op }, { onSuccess: () => setDialog(null) });

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-30 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-line bg-panel p-1.5 shadow-[var(--shadow-pop)]">
        <span className="px-2.5 text-[13px] font-medium tabular-nums">{selected.length} selected</span>
        <div className="mx-1 h-5 w-px bg-line" />
        <Button size="sm" variant="ghost" icon={<Sparkles className="size-3.5" />} onClick={onGenerate}>Generate</Button>
        <Button size="sm" variant="ghost" icon={<ImageIcon className="size-3.5" />} onClick={() => setDialog('background')}>Replace Background</Button>
        <Menu align="center" trigger={<Button size="sm" variant="ghost" icon={<Palette className="size-3.5" />}>Apply Gradient<ChevronDown className="size-3 text-muted" /></Button>}>
          {(boot?.gradientPresets ?? []).map((g) => <MenuItem key={g.id} onSelect={() => run({ action: 'apply_gradient', preset: g.id })}>{g.name}</MenuItem>)}
          <MenuSeparator />
          <MenuItem onSelect={() => run({ action: 'apply_gradient', patch: { darken: 0.15 } })}>Darker</MenuItem>
          <MenuItem onSelect={() => run({ action: 'apply_gradient', patch: { darken: -0.15 } })}>Lighter</MenuItem>
        </Menu>
        <Menu align="center" trigger={<Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />}>Toggle<ChevronDown className="size-3 text-muted" /></Button>}>
          {(['logo', 'headline', 'subheading', 'gradient'] as const).map((l) => (
            <div key={l}>
              <MenuItem icon={<Eye className="size-3.5" />} onSelect={() => run({ action: 'toggle_layer', layerId: l, visible: true })}>Show {l === 'headline' ? 'heading' : l}</MenuItem>
              <MenuItem icon={<EyeOff className="size-3.5" />} onSelect={() => run({ action: 'toggle_layer', layerId: l, visible: false })}>Hide {l === 'headline' ? 'heading' : l}</MenuItem>
            </div>
          ))}
        </Menu>
        <Button size="sm" variant="ghost" icon={<Maximize2 className="size-3.5" />} onClick={() => setDialog('resize')}>Resize</Button>
        <Button size="sm" variant="ghost" icon={<LayoutTemplate className="size-3.5" />} onClick={() => setDialog('template')}>Apply Template</Button>
        <div className="mx-1 h-5 w-px bg-line" />
        <Button size="sm" variant="ghost" icon={<ThumbsUp className="size-3.5" />} onClick={() => run({ action: 'approve' })}>Approve</Button>
        <Button size="sm" variant="ghost" icon={<ThumbsDown className="size-3.5" />} onClick={() => setDialog('reject')}>Reject</Button>
        <Button size="sm" variant="ghost" onClick={() => setDialog('export')}>Export</Button>
        <Menu align="end" trigger={<Button size="sm" variant="ghost">{scope === 'selected' ? 'Selected' : scope === 'project' ? 'Whole project' : 'Project default'}<ChevronDown className="size-3 text-muted" /></Button>}>
          <MenuItem onSelect={() => setScope('selected')}>Apply to selected cards</MenuItem>
          <MenuItem onSelect={() => setScope('project')}>Apply to whole project</MenuItem>
          <MenuItem onSelect={() => setScope('project_default')}>Change the project default</MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => setIncludeApproved(!includeApproved)} icon={includeApproved ? <CheckCircle2 className="size-3.5" /> : null}>Include approved cards{approvedCount ? ` (${approvedCount})` : ''}</MenuItem>
        </Menu>
        {batch.isPending ? <Loader2 className="mx-1 size-4 animate-spin text-muted" /> : null}
        <button onClick={onClear} className="press ml-0.5 rounded-md p-1.5 text-muted hoverable" aria-label="Clear selection"><X className="size-4" /></button>
      </div>

      {dialog === 'resize' ? <ResizeDialog open onOpenChange={() => setDialog(null)} initial={{ width: project.width, height: project.height }} busy={batch.isPending} title={`Resize ${plural(selected.length, 'card')}`}
        onResize={(c) => run({ action: 'resize', ...c })} /> : null}
      {dialog === 'template' ? <TemplateDialog open onOpenChange={() => setDialog(null)} busy={batch.isPending} onApply={(recipeId) => run({ action: 'apply_template', recipeId })} /> : null}
      {dialog === 'reject' ? <RejectDialog open onOpenChange={() => setDialog(null)} count={selected.length} busy={batch.isPending} onReject={(tags: RejectTag[], text) => run({ action: 'reject', tags, text })} /> : null}
      {dialog === 'export' ? <ExportDialog open onOpenChange={() => setDialog(null)} projectId={project.id} cardIds={selected} namingTemplate={project.namingTemplate} /> : null}
      {dialog === 'background' ? <AssetPicker open onOpenChange={() => setDialog(null)} projectId={project.id} title={`Background for ${plural(selected.length, 'card')}`}
        onPick={(a: AssetX) => run({ action: 'replace_background', assetId: a.id })} /> : null}
    </div>
  );
}

/** Brief, negative constraints and project rules — what AI always receives (PRD §35–37, §90). */
export function BriefDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (v: boolean) => void; project: Project }) {
  const qc = useQueryClient();
  const [brief, setBrief] = useState(project.brief);
  const [neg, setNeg] = useState<string[]>(project.negativeConstraints ?? []);
  const [newNeg, setNewNeg] = useState('');
  const [rule, setRule] = useState('');
  const save = useMutation({
    mutationFn: () => api.patch(`/projects/${project.id}`, { brief, negativeConstraints: neg }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['project', project.id] }); toast.success('Brief saved'); onOpenChange(false); },
    onError: (e) => toast.error(e.message),
  });
  const addRule = useMutation({
    mutationFn: (text: string) => api.post(`/projects/${project.id}/rules`, { text, source: 'manual' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['project', project.id] }); setRule(''); },
  });
  const delRule = useMutation({ mutationFn: (id: string) => api.del(`/projects/${project.id}/rules/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['project', project.id] }) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Brief & rules" description="Kept with the project. Every AI action receives these automatically." width={620}
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="flex flex-col gap-5">
        <Field label="Project brief" hint="Style, subject, mood, what to keep clear for typography.">
          <Textarea rows={5} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={'Premium corporate photography.\nDark navy/black backgrounds.\nKeep left side visually quiet for typography.'} />
        </Field>
        <div>
          <div className="mb-1.5 text-[12.5px] font-medium">Negative constraints</div>
          <div className="flex flex-col gap-1">
            {neg.map((n, i) => (
              <div key={i} className="group flex items-center gap-2 rounded-md bg-hover px-2.5 py-1.5 text-[13px]">
                <span className="flex-1">{n}</span>
                <button onClick={() => setNeg(neg.filter((_, j) => j !== i))} className="text-faint opacity-0 group-hover:opacity-100 hover:text-err" aria-label="Remove"><Trash2 className="size-3.5" /></button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Input placeholder="No generated text inside photographs." value={newNeg} onChange={(e) => setNewNeg(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newNeg.trim()) { setNeg([...neg, newNeg.trim()]); setNewNeg(''); } }} />
            <Button disabled={!newNeg.trim()} onClick={() => { setNeg([...neg, newNeg.trim()]); setNewNeg(''); }}>Add</Button>
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[12.5px] font-medium">Project rules</div>
          <div className="text-[12px] text-muted">Accepted rules only. AI can suggest rules; it never adds them on its own.</div>
          <div className="mt-2 flex flex-col gap-1">
            {(project.rules ?? []).map((r) => (
              <div key={r.id} className="group flex items-center gap-2 rounded-md bg-hover px-2.5 py-1.5 text-[13px]">
                <span className="flex-1">{r.text}</span>
                {r.source === 'suggestion' ? <Badge>From suggestion</Badge> : null}
                <button onClick={() => delRule.mutate(r.id)} className="text-faint opacity-0 group-hover:opacity-100 hover:text-err" aria-label="Remove rule"><Trash2 className="size-3.5" /></button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Input placeholder="Keep primary subjects on the right side." value={rule} onChange={(e) => setRule(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rule.trim() && addRule.mutate(rule.trim())} />
            <Button disabled={!rule.trim()} loading={addRule.isPending} onClick={() => addRule.mutate(rule.trim())}>Add rule</Button>
          </div>
        </div>
      </div>
    </Dialog>
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
  if (!active.length && !failed.length && !paused.length) return null;
  const by = (t: string) => active.filter((j) => j.type === t).length;
  const label = [by('render') && `Rendering ${plural(by('render'), 'card')}`, by('ingest') && `Downloading ${plural(by('ingest'), 'image')}`,
    by('export') && 'Exporting', active.some((j) => j.type.startsWith('ai.')) && 'AI working'].filter(Boolean).join(' · ');
  return (
    <div className="mx-8 mb-4 flex items-center gap-3 rounded-lg border border-line bg-panel px-3.5 py-2 text-[13px]">
      {active.length ? <><Loader2 className="size-3.5 animate-spin text-muted" /><span>{label || `${active.length} jobs running`}</span></> : null}
      {paused.length ? <Badge tone="warn">{plural(paused.length, 'job')} paused: provider usage limit</Badge> : null}
      {failed.length ? (
        <span className="ml-auto flex items-center gap-2 text-err">
          <AlertTriangle className="size-3.5" />{failed.length} failed
          <Button size="sm" icon={<RefreshCw className="size-3" />} loading={retry.isPending} onClick={() => retry.mutate(failed.map((f) => f.id))}>Retry {failed.length} Failed</Button>
        </span>
      ) : null}
    </div>
  );
}

/** "Website source changed" (PRD §57): nothing approved changes on its own. */
export function SourceChangesBanner({ pid, onRescan }: { pid: string; onRescan: () => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['changes', pid], queryFn: () => api.get<SourceChange[]>(`/projects/${pid}/changes`) });
  const [open, setOpen] = useState(false);
  const pending = (data ?? []).filter((c) => c.status === 'pending');
  const mark = useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: 'reviewed' | 'ignored' }) => { for (const id of ids) await api.post(`/projects/${pid}/changes/${id}`, { status }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['changes', pid] }); qc.invalidateQueries({ queryKey: ['inbox-count'] }); },
  });
  if (!pending.length) return null;
  const KIND: Record<string, string> = { headline: 'Headline changed', subheading: 'Subheading changed', banner: 'Banner changed', page_added: 'Page added', page_removed: 'Page removed', authority: 'Authority changed', highlights: 'Highlights changed' };
  return (
    <div className="mx-8 mb-4 flex items-center gap-3 rounded-lg border border-[#ecd9b3] bg-warn-bg px-3.5 py-2 text-[13px] text-[#7a4f10]">
      <AlertTriangle className="size-4" />
      <span className="flex-1">Website source changed: {plural(pending.length, 'change')}. Approved cards stay as they are.</span>
      <Button size="sm" onClick={() => setOpen(true)}>Review changes</Button>
      <Button size="sm" variant="ghost" onClick={() => mark.mutate({ ids: pending.map((p) => p.id), status: 'ignored' })}>Ignore</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Website source changed" width={720}
        footer={<><Button onClick={onRescan} icon={<RefreshCw className="size-3.5" />}>Rescan again</Button><Button variant="primary" onClick={() => { mark.mutate({ ids: pending.map((p) => p.id), status: 'reviewed' }); setOpen(false); }}>Mark all reviewed</Button></>}>
        <div className="flex flex-col divide-y divide-line">
          {pending.map((c) => (
            <div key={c.id} className="grid grid-cols-[150px_1fr] gap-3 py-2.5 text-[13px]">
              <span className="font-medium">{KIND[c.kind] ?? c.kind}</span>
              <span className="min-w-0"><span className="text-muted line-through">{c.before ?? '—'}</span><br /><span>{c.after ?? '—'}</span></span>
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}

/** "This background is used on 6 cards" (PRD §47, §92). */
export function DuplicatesNotice({ pid, onSelect }: { pid: string; onSelect: (ids: string[]) => void }) {
  const { data } = useQuery({ queryKey: ['duplicates', pid], queryFn: () => api.get<{ key: string; assetId: string; cardIds: string[]; names: string[] }[]>(`/projects/${pid}/duplicates`) });
  const batch = useBatch(pid);
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const groups = (data ?? []).filter((g) => !dismissed.includes(g.key));
  if (!groups.length) return null;
  const g = groups[0];
  const differentCrops = async () => {
    // the legacy repeat framings (render.py FOCUS), one per card
    const F = [[0.5, 0.42], [0.32, 0.46], [0.68, 0.38], [0.46, 0.3], [0.58, 0.55], [0.24, 0.34], [0.76, 0.5]];
    for (let i = 0; i < g.cardIds.length; i++) {
      const [fx, fy] = F[i % F.length];
      await batch.mutateAsync({ cardIds: [g.cardIds[i]], scope: 'selected', op: { action: 'patch', reason: 'Different crop for a repeated image', overrides: { layers: { background: { focalX: fx, focalY: fy } } } } });
    }
    qc.invalidateQueries({ queryKey: ['duplicates', pid] });
  };
  return (
    <div className="mx-8 mb-4 flex items-center gap-3 rounded-lg border border-line bg-panel px-3.5 py-2 text-[13px]">
      <Copy className="size-4 text-muted" />
      <span className="flex-1">This background is used on <b>{g.cardIds.length} cards</b>{groups.length > 1 ? ` (and ${groups.length - 1} more repeated image${groups.length > 2 ? 's' : ''})` : ''}.</span>
      <Button size="sm" variant="ghost" onClick={() => setDismissed([...dismissed, g.key])}>Keep</Button>
      <Button size="sm" variant="ghost" loading={batch.isPending} onClick={differentCrops}>Use different crops</Button>
      <Button size="sm" onClick={() => onSelect(g.cardIds)}>Select them</Button>
    </div>
  );
}

/** Mixed uploads (PRD §95): match images to pages; uncertain matches need a yes. */
export function MappingDialog({ open, onOpenChange, pid, assetIds, pages, cardsByPage }: {
  open: boolean; onOpenChange: (v: boolean) => void; pid: string; assetIds: string[]; pages: { id: string; name: string; h1: string }[]; cardsByPage: Record<string, string>;
}) {
  const qc = useQueryClient();
  const { data: matches } = useQuery({ queryKey: ['match', pid, assetIds.join(',')], enabled: open && assetIds.length > 0,
    queryFn: () => api.post<{ fileName: string; assetId: string; pageId: string | null; confidence: number }[]>(`/projects/${pid}/match-uploads`, { assetIds }) });
  const [map, setMap] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const rows = pages.map((p) => {
    const m = matches?.find((x) => (map[x.assetId] ?? x.pageId) === p.id);
    return { page: p, match: m ?? null };
  });
  const apply = useMutation({
    mutationFn: async () => {
      const newPages: string[] = [];
      const backgrounds: Record<string, string> = {};
      for (const r of rows) {
        if (!r.match) continue;
        if (r.match.confidence < 0.8 && !confirmed[r.match.assetId] && !map[r.match.assetId]) continue;
        const existing = cardsByPage[r.page.id];
        if (existing) await api.post(`/projects/${pid}/batch`, { cardIds: [existing], scope: 'selected', op: { action: 'replace_background', assetId: r.match.assetId } });
        else { newPages.push(r.page.id); backgrounds[r.page.id] = r.match.assetId; }
      }
      if (newPages.length) await api.post(`/projects/${pid}/cards`, { pageIds: newPages, backgrounds });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cards', pid] }); toast.success('Images assigned'); onOpenChange(false); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Match images to pages" description="Matched by file name, page slug and title. Confirm the uncertain ones." width={760}
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={apply.isPending} onClick={() => apply.mutate()}>Assign images</Button></>}>
      <div className="grid grid-cols-[1fr_1fr_110px] gap-x-3 border-b border-line pb-2 text-[11.5px] font-medium text-muted"><span>Page</span><span>Image</span><span>Match</span></div>
      <div className="max-h-[55vh] overflow-auto scroll-quiet">
        {rows.map(({ page, match }) => (
          <div key={page.id} className="grid grid-cols-[1fr_1fr_110px] items-center gap-x-3 border-b border-line py-2 text-[13px]">
            <span className="truncate">{page.h1 || page.name}</span>
            <select className="h-7 rounded-md border border-line bg-panel px-2 text-[12.5px]" value={match?.assetId ?? ''} onChange={(e) => {
              const aid = e.target.value;
              const next = { ...map };
              for (const [k, v] of Object.entries(next)) if (v === page.id) delete next[k];
              if (aid) next[aid] = page.id;
              setMap(next);
            }}>
              <option value="">—</option>
              {(matches ?? []).map((m) => <option key={m.assetId} value={m.assetId}>{m.fileName}</option>)}
            </select>
            <span>
              {!match ? <span className="text-faint">No image</span> : map[match.assetId] ? <Badge>Manual</Badge> : match.confidence >= 0.8 ? <Badge tone="ok">Confident</Badge> : (
                <label className="flex items-center gap-1.5 text-[12px]"><Checkbox checked={!!confirmed[match.assetId]} onCheckedChange={(v) => setConfirmed({ ...confirmed, [match.assetId]: v })} label="Confirm" />Confirm</label>
              )}
            </span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/** AI review of the whole set (PRD §89–90): suggestions only; each one is accepted, scoped, or ignored. */
export function SuggestionsPanel({ pid, onOpenCard }: { pid: string; onOpenCard: (cardId: string) => void }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['suggestions', pid], queryFn: () => api.get<Suggestion[]>(`/projects/${pid}/suggestions`), refetchInterval: 15_000 });
  const resolve = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Suggestion['status'] }) => api.post(`/projects/${pid}/suggestions/${id}`, { status }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['suggestions', pid] });
      qc.invalidateQueries({ queryKey: ['project', pid] });
      if (v.status === 'accepted_project') toast.success('Added to the project rules');
      if (v.status === 'accepted_template') toast.success('Added to the template brief');
    },
  });
  if (!data?.length) return null;
  const KIND: Record<string, string> = { rule: 'Suggested rule', consistency: 'Consistency', duplicate_subject: 'Repeated subject', fix: 'Fix' };
  return (
    <div className="mx-8 mb-4 rounded-lg border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2 text-[13px] font-medium"><Sparkles className="size-3.5" />AI review: {data.length} suggestion{data.length > 1 ? 's' : ''}<span className="font-normal text-muted">· nothing changes until you accept</span></div>
      <div className="max-h-64 divide-y divide-line overflow-auto scroll-quiet">
        {data.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2 text-[13px]">
            <Badge tone={s.kind === 'rule' ? 'info' : s.kind === 'duplicate_subject' ? 'warn' : 'neutral'}>{KIND[s.kind] ?? s.kind}</Badge>
            <span className="min-w-0 flex-1">{s.text}</span>
            {s.cardIds.length ? <Button size="sm" variant="ghost" onClick={() => onOpenCard(s.cardIds[0])}>Open card{s.cardIds.length > 1 ? ` (1 of ${s.cardIds.length})` : ''}</Button> : null}
            {s.kind === 'rule' ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => resolve.mutate({ id: s.id, status: 'accepted_card' })}>This card only</Button>
                <Button size="sm" onClick={() => resolve.mutate({ id: s.id, status: 'accepted_project' })}>Apply to project</Button>
                <Button size="sm" onClick={() => resolve.mutate({ id: s.id, status: 'accepted_template' })}>Apply to template</Button>
              </>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => resolve.mutate({ id: s.id, status: 'ignored' })}>Ignore</Button>
          </div>
        ))}
      </div>
    </div>
  );
}
