/** Choose an image from the project (or global) asset library, or upload one. */
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import { api } from '../lib/api';
import { useProjectAssets } from '../lib/queries';
import type { AssetX } from '../lib/types';
import { Button, cx, Dialog, Segmented, Spinner } from '../ui';
import { Thumb } from './Thumb';

export function AssetPicker({ open, onOpenChange, projectId, onPick, title = 'Choose an image' }: {
  open: boolean; onOpenChange: (v: boolean) => void; projectId: string; onPick: (a: AssetX) => void; title?: string;
}) {
  const [scope, setScope] = useState<'project' | 'global'>('project');
  const { data, isLoading } = useProjectAssets(scope === 'project' ? projectId : null);
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const list = (data ?? []).filter((a) => (a.type === 'image' || a.type === 'screenshot' || a.type === 'reference') && a.status !== 'failed');
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} width={880}>
      <div className="mb-3 flex items-center justify-between">
        <Segmented size="sm" value={scope} onChange={setScope} options={[{ value: 'project', label: 'This project' }, { value: 'global', label: 'Global' }]} />
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setUploading(true);
          try {
            const a = await api.upload<AssetX>(scope === 'project' ? `/projects/${projectId}/assets` : '/assets', f, { purpose: 'upload' });
            qc.invalidateQueries({ queryKey: ['assets'] });
            onPick(a);
          } catch (err) { toast.error((err as Error).message); } finally { setUploading(false); }
        }} />
        <Button size="sm" icon={<Upload className="size-3.5" />} loading={uploading} onClick={() => ref.current?.click()}>Upload</Button>
      </div>
      {isLoading ? <div className="py-16 text-center"><Spinner className="mx-auto" /></div> : list.length ? (
        <div className="grid max-h-[60vh] grid-cols-4 gap-2.5 overflow-auto scroll-quiet">
          {list.map((a) => (
            <button key={a.id} onClick={() => onPick(a)} className={cx('press overflow-hidden rounded-lg border border-line bg-panel text-left hover:border-ink')}>
              <Thumb src={a.thumbUrl ?? a.url} pending={a.status === 'pending'} />
              <div className="truncate px-2 py-1.5 text-[11.5px] text-muted">{a.name}</div>
            </button>
          ))}
        </div>
      ) : <div className="py-16 text-center text-[13px] text-muted">No images here yet. Upload one.</div>}
    </Dialog>
  );
}
