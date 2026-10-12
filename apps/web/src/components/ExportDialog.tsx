/** Export (PRD §67–69): approved cards by default; anything unapproved needs an explicit yes. */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import type { ExportBody } from '@acs/types';
import { api, ApiError } from '../lib/api';
import { Button, Checkbox, Dialog, Field, Input, Segmented } from '../ui';

export function ExportDialog({ open, onOpenChange, projectId, cardIds, defaultScope, namingTemplate }: {
  open: boolean; onOpenChange: (v: boolean) => void; projectId: string; cardIds?: string[]; defaultScope?: ExportBody['scope']; namingTemplate?: string;
}) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<ExportBody['scope']>(defaultScope ?? (cardIds?.length ? 'selected' : 'approved'));
  const [format, setFormat] = useState<ExportBody['format']>('png');
  const [scaleKey, setScaleKey] = useState<'1' | '2' | '4' | 'custom'>('1');
  const [custom, setCustom] = useState(1.5);
  const [extras, setExtras] = useState({ contactSheet: true, csv: true, manifest: true });
  const [naming, setNaming] = useState(namingTemplate ?? '{project}-{card}-{version}');
  const [confirm, setConfirm] = useState<{ unapproved: number; total: number } | null>(null);

  const run = useMutation({
    mutationFn: (includeUnapproved: boolean) => api.post('/projects/' + projectId + '/exports', {
      scope, cardIds, format, scale: scaleKey === 'custom' ? custom : Number(scaleKey), includeUnapproved, ...extras, namingTemplate: naming,
    } satisfies ExportBody),
    onSuccess: () => {
      toast.success('Export started. It will appear under Exports when ready.');
      qc.invalidateQueries({ queryKey: ['exports'] });
      setConfirm(null);
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409 && e.data.needsConfirm) setConfirm({ unapproved: Number(e.data.unapproved), total: Number(e.data.total) });
      else toast.error(e.message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setConfirm(null); }} title="Export" width={520}
      footer={confirm ? (
        <>
          <Button onClick={() => setConfirm(null)}>Back</Button>
          <Button variant="primary" loading={run.isPending} onClick={() => run.mutate(true)}>Continue with {confirm.unapproved} unapproved</Button>
        </>
      ) : (
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={run.isPending} onClick={() => run.mutate(false)}>Export</Button>
        </>
      )}>
      {confirm ? (
        <div className="flex gap-3 rounded-lg bg-warn-bg p-3 text-[13px] text-[#7a4f10]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">{confirm.unapproved} selected card{confirm.unapproved === 1 ? ' is' : 's are'} not approved.</div>
            <div className="mt-1">Their current version will be exported and marked as unapproved in the manifest. Approved cards always export their approved version.</div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Cards">
            <Segmented value={scope} onChange={setScope} options={[
              ...(cardIds?.length === 1 ? [{ value: 'current' as const, label: 'This card' }] : []),
              ...(cardIds?.length ? [{ value: 'selected' as const, label: `Selected (${cardIds.length})` }] : []),
              { value: 'approved', label: 'Approved' },
              { value: 'all', label: 'Whole project' },
            ]} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Format">
              <Segmented value={format} onChange={setFormat} options={[{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPG' }, { value: 'webp', label: 'WebP' }]} />
            </Field>
            <Field label="Resolution">
              <Segmented value={scaleKey} onChange={setScaleKey} options={[{ value: '1', label: '1×' }, { value: '2', label: '2×' }, { value: '4', label: '4×' }, { value: 'custom', label: 'Custom' }]} />
            </Field>
          </div>
          {scaleKey === 'custom' ? (
            <Field label="Custom scale" hint="Relative to the canvas size: 1.5 makes a 1600 × 1000 card 2400 × 1500.">
              <Input type="number" step={0.25} min={0.25} max={4} value={custom} onChange={(e) => setCustom(Math.min(4, Math.max(0.25, Number(e.target.value) || 1)))} />
            </Field>
          ) : null}
          <Field label="File names" hint="Tokens: {project} {card} {version} {n} {w} {h} {country} {status}">
            <Input value={naming} onChange={(e) => setNaming(e.target.value)} />
          </Field>
          <div className="flex flex-col gap-2">
            <span className="text-[12.5px] font-medium">Also include</span>
            {([['contactSheet', 'Contact sheet'], ['csv', 'INDEX.csv, links and source URL index'], ['manifest', 'Manifest (manifest.json)']] as const).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={extras[k]} onCheckedChange={(v) => setExtras({ ...extras, [k]: v })} label={label} />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}
