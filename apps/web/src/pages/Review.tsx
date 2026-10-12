/** Exception inbox (PRD §48): every problem in one place instead of buried console errors. */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { useBootstrap } from '../lib/queries';
import { PageHeader } from '../shell/AppShell';
import { Button, cx, Empty, Spinner } from '../ui';

interface Item { category: string; label: string; projectId: string; projectName: string; cardId: string | null; cardName: string | null; message: string; thumbUrl: string | null; jobId?: string; changeId?: string }

export function ReviewPage() {
  const { data, isLoading, refetch, isFetching } = useQuery({ queryKey: ['inbox'], queryFn: () => api.get<Item[]>('/inbox') });
  const { data: boot } = useBootstrap();
  const [cat, setCat] = useState<string>('all');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const retry = useMutation({ mutationFn: (id: string) => api.post(`/jobs/${id}/retry`), onSuccess: () => { toast.success('Retrying'); qc.invalidateQueries({ queryKey: ['inbox'] }); } });
  const cats = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const i of data ?? []) m.set(i.category, { label: i.label, n: (m.get(i.category)?.n ?? 0) + 1 });
    const order = [...(boot?.inboxCategories ?? []).map((c) => c.key), 'source_changed', 'awaiting'];
    return [...m.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [data, boot]);
  const list = (data ?? []).filter((i) => cat === 'all' || i.category === cat);

  return (
    <div className="mx-auto max-w-[1180px] pb-16">
      <PageHeader title="Review" sub="Missing images, overflow, duplicates, failed jobs, source changes and cards awaiting approval, across all projects."
        actions={<Button icon={<RefreshCw className={cx('size-3.5', isFetching && 'animate-spin')} />} onClick={() => refetch()}>Refresh</Button>} />
      {isLoading ? <Spinner className="mx-auto mt-16" /> : !data?.length ? (
        <Empty icon={<CheckCircle2 className="size-8" strokeWidth={1.5} />} title="Nothing needs attention">New warnings and cards awaiting approval appear here.</Empty>
      ) : (
        <div className="grid grid-cols-[220px_1fr] gap-6 px-8">
          <div className="flex flex-col gap-0.5">
            <button onClick={() => setCat('all')} className={cx('press flex h-8 items-center justify-between rounded-md px-2.5 text-[13px]', cat === 'all' ? 'bg-ink text-white' : 'hoverable')}>All<span className="text-[11.5px] opacity-70">{data.length}</span></button>
            {cats.map(([k, v]) => (
              <button key={k} onClick={() => setCat(k)} className={cx('press flex h-8 items-center justify-between rounded-md px-2.5 text-[13px]', cat === k ? 'bg-ink text-white' : 'hoverable')}>{v.label}<span className="text-[11.5px] opacity-70">{v.n}</span></button>
            ))}
          </div>
          <div className="overflow-hidden rounded-xl border border-line bg-panel">
            {list.map((i, k) => (
              <div key={k} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
                <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-hover">{i.thumbUrl ? <img src={i.thumbUrl} alt="" loading="lazy" className="size-full object-cover" /> : null}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{i.cardName ?? i.label}</div>
                  <div className="truncate text-[12px] text-muted">{i.message}</div>
                </div>
                <Link to={`/p/${i.projectId}`} className="hidden truncate text-[12px] text-muted hover:text-ink md:block">{i.projectName}</Link>
                {i.jobId ? <Button size="sm" onClick={() => retry.mutate(i.jobId!)}>Retry</Button> : null}
                {i.cardId ? <Button size="sm" onClick={() => navigate(`/p/${i.projectId}/c/${i.cardId}`)}>Fix</Button> : <Button size="sm" onClick={() => navigate(`/p/${i.projectId}`)}>Open</Button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
