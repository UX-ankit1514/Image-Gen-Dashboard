/** Settings: naming, defaults, success metrics (PRD §83) and the audit log (§80). */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AuditEvent } from '@acs/types';
import { api } from '../lib/api';
import { ago } from '../lib/format';
import { useBootstrap } from '../lib/queries';
import { PageHeader } from '../shell/AppShell';
import { Button, Field, Input, Kbd, Select, Spinner } from '../ui';

interface Stats { projects: number; approvals: number; rejections: number; exports: number; medianSecondsUrlToCards: number | null; renderFailureRate: number | null; exportFailureRate: number | null; ingestFailureRate: number | null; aiJobs: number }

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);

export function SettingsPage() {
  const { data: boot } = useBootstrap();
  const qc = useQueryClient();
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.get<Stats>('/stats') });
  const audit = useQuery({ queryKey: ['audit'], queryFn: () => api.get<AuditEvent[]>('/audit') });
  const [naming, setNaming] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.patch('/workspace', { namingTemplate: naming ?? boot?.workspace.settings.namingTemplate, defaultProvider: provider ?? boot?.workspace.settings.defaultProvider }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bootstrap'] }); toast.success('Settings saved'); },
  });
  const s = stats.data;
  return (
    <div className="mx-auto max-w-[960px] pb-16">
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-6 px-8">
        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="mb-4 text-[15px] font-semibold">Workspace</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Default file names" hint="{project}-{card}-{version} · also {n} {w} {h} {country} {status}">
              <Input value={naming ?? boot?.workspace.settings.namingTemplate ?? ''} onChange={(e) => setNaming(e.target.value)} />
            </Field>
            <Field label="Default AI provider for new projects">
              <Select value={(provider ?? boot?.workspace.settings.defaultProvider ?? 'auto') as string} onChange={setProvider} options={[{ value: 'auto', label: 'Automatic' }, { value: 'chatgpt', label: 'ChatGPT' }, { value: 'claude', label: 'Claude' }, { value: 'none', label: 'None' }]} />
            </Field>
          </div>
          <Button className="mt-4" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </section>

        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="mb-1 text-[15px] font-semibold">How the studio is doing</h2>
          <p className="mb-4 text-[12.5px] text-muted">From the activity log and job history. The goal: creative work finished inside Creative Studio, without detours through chat windows and folders.</p>
          {!s ? <Spinner /> : (
            <div className="grid grid-cols-4 gap-3">
              {[['Projects', s.projects], ['Approvals', s.approvals], ['Rejections', s.rejections], ['Exports', s.exports],
                ['URL → first cards', s.medianSecondsUrlToCards === null ? '—' : `${Math.round(s.medianSecondsUrlToCards)} s`], ['Render failures', pct(s.renderFailureRate)],
                ['Export failures', pct(s.exportFailureRate)], ['AI jobs run', s.aiJobs]].map(([k, v]) => (
                <div key={String(k)} className="rounded-lg bg-hover px-3 py-2.5"><div className="text-[11.5px] text-muted">{k}</div><div className="mt-0.5 text-[18px] font-semibold tabular-nums">{v}</div></div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="mb-3 text-[15px] font-semibold">Keyboard</h2>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-[13px]">
            {[['⌘Z', 'Undo'], ['⇧⌘Z', 'Redo'], ['Delete', 'Remove selected layer'], ['Arrow', 'Nudge 1 px'], ['⇧ Arrow', 'Nudge 10 px'], ['⌘D', 'Duplicate'], ['⌘S', 'Save a version'], ['0', 'Fit canvas'], ['1', '100%'], ['Space + drag', 'Pan'], ['Alt while dragging', 'No snapping'], ['⌘V', 'Paste an image']].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between border-b border-line py-1"><span>{v}</span><Kbd>{k}</Kbd></div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-line bg-panel p-5">
          <h2 className="mb-3 text-[15px] font-semibold">Activity</h2>
          {audit.isLoading ? <Spinner /> : (
            <div className="max-h-96 divide-y divide-line overflow-auto scroll-quiet">
              {(audit.data ?? []).map((e) => (
                <div key={e.id} className="flex items-center gap-3 py-2 text-[12.5px]">
                  <span className="w-40 shrink-0 font-medium">{e.type}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{Object.entries(e.data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}</span>
                  <span className="shrink-0 text-faint">{e.actor} · {ago(e.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
