/** Templates / recipes (PRD §38): view, duplicate, edit brief and defaults. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { CardScene, updateLayer } from '@acs/renderer';
import type { Design, TextLayer } from '@acs/types';
import { api } from '../lib/api';
import { builtinUrl } from '../lib/builtins';
import { PageHeader } from '../shell/AppShell';
import { Badge, Button, Dialog, Field, Input, Spinner, Textarea } from '../ui';

interface RecipeDoc { id: string; name: string; description: string; builtin: boolean; base: Design; brief?: string; negativeConstraints?: string[] }

function sample(d: Design) {
  let x = updateLayer(d, 'headline', { text: 'Ireland Company Setup' } as Partial<TextLayer>);
  x = updateLayer(x, 'subheading', { text: 'Fast and efficient setup' } as Partial<TextLayer>);
  return { ...x, canvas: { ...x.canvas, background: '#5b6aa8' } };
}

export function TemplatesPage() {
  const { data, isLoading } = useQuery({ queryKey: ['recipes'], queryFn: () => api.get<RecipeDoc[]>('/recipes') });
  const [edit, setEdit] = useState<RecipeDoc | null>(null);
  const qc = useQueryClient();
  const dup = useMutation({
    mutationFn: (r: RecipeDoc) => api.post('/recipes', { name: `${r.name} copy`, fromRecipeId: r.id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recipes'] }); qc.invalidateQueries({ queryKey: ['bootstrap'] }); toast.success('Template duplicated'); },
  });
  return (
    <div className="mx-auto max-w-[1280px] pb-16">
      <PageHeader title="Templates" sub="Recipes capture repeated production logic: which layers, where, in what style." />
      {isLoading ? <Spinner className="mx-auto mt-16" /> : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4 px-8">
          {(data ?? []).map((r) => {
            const scale = 300 / r.base.canvas.width;
            return (
              <div key={r.id} className="overflow-hidden rounded-xl border border-line bg-panel">
                <div className="flex items-center justify-center bg-canvas p-3" style={{ height: 210 }}>
                  <div style={{ width: r.base.canvas.width * Math.min(scale, 180 / r.base.canvas.height), height: r.base.canvas.height * Math.min(scale, 180 / r.base.canvas.height) }} className="overflow-hidden rounded-[3px]">
                    <div style={{ transform: `scale(${Math.min(scale, 180 / r.base.canvas.height)})`, transformOrigin: '0 0' }}><CardScene design={sample(r.base)} resolveSrc={builtinUrl} /></div>
                  </div>
                </div>
                <div className="p-3">
                  <div className="flex items-center gap-2 text-[14px] font-medium">{r.name}{r.builtin ? <Badge>Built-in</Badge> : null}</div>
                  <div className="mt-0.5 line-clamp-2 text-[12px] text-muted">{r.description}</div>
                  <div className="mt-1 text-[11.5px] text-faint tabular-nums">{r.base.canvas.width} × {r.base.canvas.height} · {r.base.layers.filter((l) => l.visible).map((l) => l.name).join(', ')}</div>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={() => setEdit(r)}>Edit</Button>
                    <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => dup.mutate(r)}>Duplicate</Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {edit ? <EditRecipe r={edit} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}

function EditRecipe({ r, onClose }: { r: RecipeDoc; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(r.name);
  const [description, setDescription] = useState(r.description);
  const [brief, setBrief] = useState(r.brief ?? '');
  const [neg, setNeg] = useState((r.negativeConstraints ?? []).join('\n'));
  const save = useMutation({
    mutationFn: () => api.patch(`/recipes/${r.id}`, { name, description, brief, negativeConstraints: neg.split('\n').map((x) => x.trim()).filter(Boolean) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recipes'] }); qc.invalidateQueries({ queryKey: ['bootstrap'] }); toast.success('Template saved'); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={onClose} title={`Edit ${r.name}`} description="New projects start from these defaults. Existing projects keep theirs." width={600}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Default brief"><Textarea rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} /></Field>
        <Field label="Default negative constraints" hint="One per line."><Textarea rows={4} value={neg} onChange={(e) => setNeg(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
