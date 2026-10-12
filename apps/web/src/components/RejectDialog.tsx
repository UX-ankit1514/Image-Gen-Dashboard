/** Structured rejection (PRD §42): the reasons are what regeneration reads later (§43). */
import { useState } from 'react';
import { REJECT_TAGS, type RejectTag } from '@acs/types';
import { Button, cx, Dialog, Textarea } from '../ui';

export function RejectDialog({ open, onOpenChange, onReject, count = 1, busy }: {
  open: boolean; onOpenChange: (v: boolean) => void; onReject: (tags: RejectTag[], text: string) => void; count?: number; busy?: boolean;
}) {
  const [tags, setTags] = useState<RejectTag[]>([]);
  const [text, setText] = useState('');
  const toggle = (t: RejectTag) => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={count > 1 ? `Reject ${count} cards` : 'Reject'} description="What's wrong? This is kept with the card and used when it is regenerated." width={560}
      footer={<><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="danger" disabled={!tags.length} loading={busy} onClick={() => onReject(tags, text.trim())}>Reject</Button></>}>
      <div className="flex flex-wrap gap-1.5">
        {REJECT_TAGS.map((t) => (
          <button key={t} onClick={() => toggle(t)} className={cx('press h-7 rounded-full border px-3 text-[12.5px]', tags.includes(t) ? 'border-ink bg-ink text-white' : 'border-line bg-panel hover:border-line-strong')}>{t}</button>
        ))}
      </div>
      <Textarea className="mt-4" rows={3} placeholder="Optional: Make the image more professional and remove the building." value={text} onChange={(e) => setText(e.target.value)} />
    </Dialog>
  );
}
