/** Asset library (PRD §46): project-level and global. */
import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import { api } from '../lib/api';
import { useProjectAssets, useProjects } from '../lib/queries';
import type { AssetX } from '../lib/types';
import { PageHeader } from '../shell/AppShell';
import { Badge, Button, cx, Dialog, Empty, Select, Spinner } from '../ui';
import { Thumb } from '../components/Thumb';
import { AssetFlags } from './Scan';

const GROUPS = [
  { key: 'all', label: 'All' }, { key: 'website', label: 'Website Images' }, { key: 'upload', label: 'Uploads' }, { key: 'generated', label: 'Generated' },
  { key: 'reference', label: 'References' }, { key: 'logo', label: 'Logos' },
];

export function AssetsPage() {
  const [params, setParams] = useSearchParams();
  const { data: projects } = useProjects();
  const pid = params.get('project') ?? 'global';
  const { data, isLoading } = useProjectAssets(pid === 'global' ? null : pid);
  const [group, setGroup] = useState('all');
  const [open, setOpen] = useState<AssetX | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const upload = useMutation({
    mutationFn: (f: File) => api.upload(pid === 'global' ? '/assets' : `/projects/${pid}/assets`, f, { purpose: pid === 'global' ? 'logo' : 'upload' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
    onError: (e) => toast.error(e.message),
  });
  const analyse = useMutation({
    mutationFn: (id: string) => api.post(`/assets/${id}/analyze`, {}),
    onSuccess: () => toast.success('Analysing: the description and text/logo flags will update shortly.'),
    onError: (e) => toast.error(e.message),
  });
  const list = useMemo(() => (data ?? []).filter((a) => {
    if (group === 'all') return true;
    if (group === 'reference') return a.type === 'reference';
    if (group === 'logo') return a.type === 'logo';
    if (group === 'upload') return a.source === 'upload' || a.source === 'screenshot';
    return a.source === group;
  }), [data, group]);

  return (
    <div className="mx-auto max-w-[1280px] pb-16">
      <PageHeader title="Assets" sub="Every image a project has found, uploaded or generated. Reusable across cards."
        actions={<>
          <div className="w-64"><Select value={pid} onChange={(v) => setParams(v === 'global' ? {} : { project: v })} options={[{ value: 'global', label: 'Global brand assets' }, ...(projects ?? []).map((p) => ({ value: p.id, label: p.name }))]} /></div>
          <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
          <Button icon={<Upload className="size-3.5" />} loading={upload.isPending} onClick={() => ref.current?.click()}>Upload</Button>
        </>} />
      <div className="flex gap-1.5 px-8 pb-4">
        {GROUPS.map((g) => <button key={g.key} onClick={() => setGroup(g.key)} className={cx('press h-7 rounded-full border px-3 text-[12.5px]', group === g.key ? 'border-ink bg-ink text-white' : 'border-line bg-panel hover:border-line-strong')}>{g.label}</button>)}
      </div>
      {isLoading ? <Spinner className="mx-auto mt-16" /> : list.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 px-8">
          {list.map((a) => (
            <button key={a.id} onClick={() => setOpen(a)} className="press overflow-hidden rounded-lg border border-line bg-panel text-left hover:border-line-strong">
              <Thumb src={a.thumbUrl ?? a.url} pending={a.status === 'pending'} />
              <div className="p-2">
                <div className="truncate text-[12.5px]">{a.name}</div>
                <div className="text-[11px] text-faint tabular-nums">{a.width ? `${a.width} × ${a.height}` : a.status}</div>
              </div>
            </button>
          ))}
        </div>
      ) : <Empty title="No assets here" />}
      {open ? (
        <Dialog open onOpenChange={() => setOpen(null)} title={open.name} width={760}>
          <img src={open.previewUrl ?? open.url ?? ''} alt="" className="w-full rounded-md bg-hover" />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
            <Badge>{open.source}</Badge><Badge>{open.type}</Badge>
            {open.width ? <span className="tabular-nums">{open.width} × {open.height} · {(open.bytes / 1024 / 1024).toFixed(2)} MB · {open.mimeType}</span> : null}
            <AssetFlags a={open} />
          </div>
          {open.sourceUrl ? <a href={open.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 block truncate text-[12px] text-info">{open.sourceUrl}</a> : null}
          {open.analysis?.description ? <p className="mt-2 text-[12.5px]">{open.analysis.description}</p> : null}
          <div className="mt-3 flex gap-2">
            {open.url ? <a href={open.url} download><Button size="sm">Download original</Button></a> : null}
            <Button size="sm" loading={analyse.isPending} onClick={() => analyse.mutate(open.id)}>Analyse with AI</Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
