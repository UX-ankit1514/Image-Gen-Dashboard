import { useState } from 'react';
import { useBootstrap } from '../lib/queries';
import { Button, cx, Dialog } from '../ui';

export function TemplateDialog({ open, onOpenChange, onApply, busy }: { open: boolean; onOpenChange: (v: boolean) => void; onApply: (recipeId: string) => void; busy?: boolean }) {
  const { data: boot } = useBootstrap();
  const [id, setId] = useState('arnifi-light');
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Apply template" description="The look changes; each card keeps its image, headline and key line." width={640}
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => onApply(id)}>Apply</Button></>}>
      <div className="grid grid-cols-3 gap-2">
        {(boot?.recipes ?? []).map((r) => (
          <button key={r.id} onClick={() => setId(r.id)} className={cx('press rounded-lg border px-3 py-2.5 text-left', id === r.id ? 'border-ink shadow-[0_0_0_1px_#111]' : 'border-line hover:border-line-strong')}>
            <div className="text-[13px] font-medium">{r.name}</div>
            <div className="mt-0.5 line-clamp-2 text-[11.5px] text-muted">{r.description}</div>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
