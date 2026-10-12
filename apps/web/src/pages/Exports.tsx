import { Download, FileArchive, Loader2 } from 'lucide-react';
import { ago, plural } from '../lib/format';
import { useExports } from '../lib/queries';
import { PageHeader } from '../shell/AppShell';
import { Badge, Button, Empty, Spinner } from '../ui';

export function ExportsPage() {
  const { data, isLoading } = useExports();
  return (
    <div className="mx-auto max-w-[1080px] pb-16">
      <PageHeader title="Exports" sub="Every export, with what went into it. Approved versions only, unless you chose otherwise." />
      {isLoading ? <Spinner className="mx-auto mt-16" /> : !data?.length ? <Empty icon={<FileArchive className="size-8" strokeWidth={1.5} />} title="No exports yet">Export from a project or a card.</Empty> : (
        <div className="mx-8 overflow-hidden rounded-xl border border-line bg-panel">
          {data.map((e) => (
            <div key={e.id} className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">{e.projectName} <span className="font-normal text-muted">· {plural(e.files.length, 'card')} · {e.format.toUpperCase()} · {e.scale}×</span></div>
                <div className="mt-0.5 flex items-center gap-2 text-[12px] text-muted">
                  <span>{ago(e.createdAt)}</span>
                  <span>{e.scope === 'approved' ? 'Approved cards' : e.scope === 'all' ? 'Whole project' : e.scope === 'current' ? 'One card' : 'Selected cards'}</span>
                  {e.includesUnapproved ? <Badge tone="warn">{e.includesUnapproved} unapproved included</Badge> : null}
                </div>
              </div>
              {e.status === 'completed' ? (
                <a href={e.zipUrl ?? undefined}><Button size="sm" variant="primary" icon={<Download className="size-3.5" />}>Download ZIP</Button></a>
              ) : e.status === 'failed' ? <Badge tone="err">{e.error ?? 'Failed'}</Badge> : <span className="flex items-center gap-1.5 text-[12.5px] text-muted"><Loader2 className="size-3.5 animate-spin" />Rendering…</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
