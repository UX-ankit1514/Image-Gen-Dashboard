/** Settings: only what changes how Export behaves. */
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useBootstrap } from '../lib/queries';
import { PageHeader } from '../shell/AppShell';
import { Field, Input, Segmented } from '../ui';

type Format = 'png' | 'jpg' | 'webp';

export function SettingsPage() {
  const { data: boot } = useBootstrap();
  const qc = useQueryClient();
  const settings = boot?.workspace.settings;
  const format: Format = settings?.exportFormat ?? 'jpg';
  const [naming, setNaming] = useState('');
  useEffect(() => { if (settings) setNaming(settings.namingTemplate); }, [settings?.namingTemplate]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (b: { exportFormat?: Format; namingTemplate?: string }) => api.patch('/workspace', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bootstrap'] }); toast.success('Saved'); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-[640px] pb-16">
      <PageHeader title="Settings" />
      <div className="mx-8 flex flex-col gap-5 rounded-2xl border border-line bg-panel p-6">
        <Field label="Export downloads as" hint="JPG is the smallest file. PNG is lossless.">
          <Segmented value={format} onChange={(exportFormat) => save.mutate({ exportFormat })} options={[{ value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }]} />
        </Field>
        <Field label="File names" hint="{project}-{card}-{version} · also {n} {w} {h} {country}">
          <Input value={naming} onChange={(e) => setNaming(e.target.value)}
            onBlur={() => { const v = naming.trim(); if (v && v !== settings?.namingTemplate) save.mutate({ namingTemplate: v }); }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        </Field>
      </div>
    </div>
  );
}
