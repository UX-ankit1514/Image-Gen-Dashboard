/** Left panel (PRD §18, §20, §44, §46): Layers · Assets · History. */
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, EyeOff, GitCompare, Image as ImageIcon, Lock, MoreHorizontal, Palette, Plus, RotateCcw, Shapes, Sparkles, Square, Trash2, Type, Unlock, Upload } from 'lucide-react';
import { newId } from '@acs/shared';
import type { Layer, ShapeLayer, TextLayer } from '@acs/types';
import { api } from '../lib/api';
import { ago } from '../lib/format';
import { useProjectAssets } from '../lib/queries';
import type { AssetX, VersionX } from '../lib/types';
import { useEditor } from './store';
import { useEditorCtx } from './context';
import { Badge, Button, cx, IconButton, Menu, MenuItem, MenuSeparator, Spinner, Tab, TabList, TabPanel, Tabs } from '../ui';
import { Thumb } from '../components/Thumb';
import { CompareDialog } from './Compare';

const ICON: Record<Layer['type'], React.ReactNode> = {
  background: <ImageIcon className="size-3.5" />, gradient: <Palette className="size-3.5" />, logo: <Sparkles className="size-3.5" />,
  text: <Type className="size-3.5" />, shape: <Square className="size-3.5" />, image: <ImageIcon className="size-3.5" />,
};

export function LeftPanel() {
  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-panel">
      <Tabs defaultValue="layers" className="flex min-h-0 flex-1 flex-col">
        <div className="px-3 pt-3"><TabList><Tab value="layers">Layers</Tab><Tab value="assets">Assets</Tab><Tab value="history">History</Tab></TabList></div>
        <TabPanel value="layers" className="min-h-0 flex-1 overflow-y-auto scroll-quiet"><LayersPanel /></TabPanel>
        <TabPanel value="assets" className="min-h-0 flex-1 overflow-y-auto scroll-quiet"><AssetsPanel /></TabPanel>
        <TabPanel value="history" className="min-h-0 flex-1 overflow-y-auto scroll-quiet"><HistoryPanel /></TabPanel>
      </Tabs>
    </aside>
  );
}

export function deleteOrHide(ids: string[]) {
  const s = useEditor.getState();
  const d = s.design;
  if (!d) return;
  const prot = d.layers.filter((l) => ids.includes(l.id) && l.protected);
  const del = ids.filter((id) => !prot.some((p) => p.id === id));
  s.apply((x) => ({
    ...x,
    layers: x.layers.filter((l) => !del.includes(l.id)).map((l) => (prot.some((p) => p.id === l.id) ? { ...l, visible: false } : l))
      .map((l) => (l.type === 'text' && l.stackOn && del.includes(l.stackOn) ? { ...l, stackOn: null } : l)),
  }));
  s.select([]);
  if (prot.length) toast(`${prot.map((p) => p.name).join(', ')} ${prot.length > 1 ? 'are template layers' : 'is a template layer'}: hidden instead of deleted.`);
}

export function duplicateLayers(ids: string[]) {
  const s = useEditor.getState();
  const d = s.design;
  if (!d) return;
  const copies: Layer[] = [];
  s.apply((x) => {
    const layers = [...x.layers];
    for (const id of ids) {
      const i = layers.findIndex((l) => l.id === id);
      const l = layers[i];
      if (!l || l.type === 'background' || l.type === 'gradient') continue;
      const c = { ...JSON.parse(JSON.stringify(l)), id: newId(l.type), name: `${l.name} copy`, protected: false, x: l.x + 24, y: l.y + 24 } as Layer;
      if (c.type === 'text') { c.stackOn = null; c.role = 'body'; }
      layers.splice(i + 1, 0, c);
      copies.push(c);
    }
    return { ...x, layers };
  });
  s.select(copies.map((c) => c.id));
}

function LayersPanel() {
  const design = useEditor((s) => s.design);
  const selection = useEditor((s) => s.selection);
  const { select, updateLayer, apply } = useEditor.getState();
  const ctx = useEditorCtx();
  const dragId = useRef<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  if (!design) return null;
  const top = [...design.layers].reverse();

  const move = (id: string, beforeId: string) => apply((d) => {
    const layers = d.layers.filter((l) => l.id !== id);
    const moving = d.layers.find((l) => l.id === id)!;
    const target = layers.findIndex((l) => l.id === beforeId);
    layers.splice(target + 1, 0, moving);       // panel is top-first; "drop on" = place above it
    return { ...d, layers };
  });

  const add = (kind: 'text' | 'shape' | 'image') => {
    const W = design.canvas.width;
    const H = design.canvas.height;
    let l: Layer;
    if (kind === 'text') {
      l = { id: newId('text'), name: 'Text', type: 'text', role: 'body', visible: true, locked: false, x: W * 0.1, y: H * 0.4, width: W * 0.5, height: 60, rotation: 0, opacity: 1,
        text: 'New text', suffix: null, provenance: { kind: 'manual', original: null }, fontFamily: 'Inter', fontWeight: 500, fontSize: Math.round(40 * W / 1600), autoSize: null,
        lineHeight: 1.2, letterSpacing: 0, textTransform: 'none', align: 'left', color: '#ffffff', maxLines: 4, shadows: [], anchorY: 'top', stackOn: null, stackGap: 0, lead: null, rule: null } satisfies TextLayer;
    } else if (kind === 'shape') {
      l = { id: newId('shape'), name: 'Rectangle', type: 'shape', shape: 'rect', fill: 'rgba(17,17,17,0.6)', radius: 12, visible: true, locked: false, x: W * 0.35, y: H * 0.35, width: W * 0.3, height: H * 0.3, rotation: 0, opacity: 1 } satisfies ShapeLayer;
    } else {
      ctx.pickImage('image-layer');
      return;
    }
    apply((d) => ({ ...d, layers: [...d.layers, l] }));
    select([l.id]);
  };

  return (
    <div className="px-2 py-2">
      <div className="flex items-center justify-between px-1.5 pb-1">
        <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">Layers</span>
        <Menu align="end" trigger={<IconButton size="sm" label="Add layer"><Plus className="size-3.5" /></IconButton>}>
          <MenuItem icon={<Type className="size-3.5" />} onSelect={() => add('text')}>Text</MenuItem>
          <MenuItem icon={<Shapes className="size-3.5" />} onSelect={() => add('shape')}>Shape</MenuItem>
          <MenuItem icon={<ImageIcon className="size-3.5" />} onSelect={() => add('image')}>Image</MenuItem>
        </Menu>
      </div>
      {top.map((l) => {
        const sel = selection.includes(l.id);
        const stacked = l.type === 'text' && l.stackOn;
        return (
          <div
            key={l.id}
            draggable
            onDragStart={() => { dragId.current = l.id; }}
            onDragOver={(e) => { e.preventDefault(); setOver(l.id); }}
            onDragLeave={() => setOver(null)}
            onDrop={() => { if (dragId.current && dragId.current !== l.id) move(dragId.current, l.id); dragId.current = null; setOver(null); }}
            onClick={(e) => select(e.shiftKey ? (sel ? selection.filter((x) => x !== l.id) : [...selection, l.id]) : [l.id])}
            className={cx('group flex h-8 cursor-default items-center gap-2 rounded-md px-1.5 text-[12.5px]', sel ? 'bg-ink text-white' : 'hoverable', over === l.id && 'shadow-[inset_0_2px_0_#111]', !l.visible && !sel && 'text-faint')}
            data-testid={`layer-${l.id}`}
          >
            <span className={cx('flex size-5 items-center justify-center', stacked && 'ml-3')}>{ICON[l.type]}</span>
            <span className="min-w-0 flex-1 truncate">{l.name}</span>
            {l.protected ? <span title="Template layer: can be hidden, not deleted" className={cx('size-1.5 shrink-0 rounded-full', sel ? 'bg-white/50' : 'bg-line-strong')} /> : null}
            <button aria-label={l.locked ? 'Unlock' : 'Lock'} onClick={(e) => { e.stopPropagation(); updateLayer(l.id, { locked: !l.locked }); }}
              className={cx('flex size-5 items-center justify-center rounded', l.locked ? '' : 'opacity-0 group-hover:opacity-100')}>
              {l.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
            </button>
            <button aria-label={l.visible ? 'Hide' : 'Show'} onClick={(e) => { e.stopPropagation(); updateLayer(l.id, { visible: !l.visible }); }}
              className="flex size-5 items-center justify-center rounded">
              {l.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            </button>
            <Menu align="end" trigger={<button aria-label="Layer actions" onClick={(e) => e.stopPropagation()} className="flex size-5 items-center justify-center rounded opacity-0 group-hover:opacity-100"><MoreHorizontal className="size-3.5" /></button>}>
              <MenuItem icon={<Copy className="size-3.5" />} disabled={l.type === 'background' || l.type === 'gradient'} onSelect={() => duplicateLayers([l.id])} shortcut="⌘D">Duplicate</MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Trash2 className="size-3.5" />} danger={!l.protected} onSelect={() => deleteOrHide([l.id])}>{l.protected ? 'Hide (template layer)' : 'Delete'}</MenuItem>
            </Menu>
          </div>
        );
      })}
      <div className="px-1.5 pt-3 text-[11px] leading-relaxed text-faint">Drag to reorder. Layers with a dot come from the template: they can be hidden but not deleted.</div>
    </div>
  );
}

function AssetsPanel() {
  const ctx = useEditorCtx();
  const pid = ctx.bundle.project.id;
  const { data, isLoading } = useProjectAssets(pid);
  const apply = useEditor((s) => s.apply);
  const qc = useQueryClient();
  const ref = useRef<HTMLInputElement>(null);
  const pageAssetIds = useMemo(() => new Set((ctx.bundle.page?.images ?? []).map((i) => i.assetId).filter(Boolean)), [ctx.bundle.page]);
  const upload = useMutation({
    mutationFn: (f: File) => api.upload<AssetX>(`/projects/${pid}/assets`, f, { purpose: 'upload' }),
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: ['assets', pid] }); setAsBackground(a); },
    onError: (e) => toast.error(e.message),
  });
  const setAsBackground = (a: AssetX) => {
    ctx.assets.set(a.id, a);
    apply((d) => ({ ...d, layers: d.layers.map((l) => (l.type === 'background' ? { ...l, assetId: a.id, source: a.source === 'website' ? 'website' : a.source === 'generated' ? 'generated' : 'uploaded', visible: true, focalX: 0.5, focalY: 0.42, zoom: 1, offsetX: 0, offsetY: 0 } : l)) }));
  };
  const list = (data ?? []).filter((a) => a.type !== 'preview' && a.type !== 'export' && a.status !== 'failed');
  const groups: [string, AssetX[]][] = [
    ['This page', list.filter((a) => pageAssetIds.has(a.id))],
    ['Uploads', list.filter((a) => a.source === 'upload' || a.source === 'screenshot')],
    ['Generated', list.filter((a) => a.source === 'generated')],
    ['References', list.filter((a) => a.type === 'reference')],
    ['Website', list.filter((a) => a.source === 'website' && !pageAssetIds.has(a.id))],
  ];
  return (
    <div className="px-3 py-2">
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
      <Button size="sm" className="mb-3 w-full" icon={<Upload className="size-3.5" />} loading={upload.isPending} onClick={() => ref.current?.click()}>Upload or paste (⌘V)</Button>
      {isLoading ? <Spinner className="mx-auto" /> : groups.filter(([, g]) => g.length).map(([name, g]) => (
        <div key={name} className="mb-3">
          <div className="pb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">{name} · {g.length}</div>
          <div className="grid grid-cols-2 gap-1.5">
            {g.map((a) => (
              <button key={a.id} title={`${a.name}\nClick to use as background`} onClick={() => setAsBackground(a)} className="press overflow-hidden rounded-md border border-line hover:border-ink">
                <Thumb src={a.thumbUrl ?? a.url} pending={a.status === 'pending'} />
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="text-[11px] text-faint">Click an image to make it this card's background.</div>
    </div>
  );
}

function HistoryPanel() {
  const ctx = useEditorCtx();
  const { card, versions, feedback } = ctx.bundle;
  const setPreview = useEditor((s) => s.setPreview);
  const qc = useQueryClient();
  const [compare, setCompare] = useState<VersionX | null>(null);
  const restore = useMutation({
    mutationFn: (v: VersionX) => api.post(`/projects/${card.projectId}/cards/${card.id}/restore/${v.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['card', card.id] }); toast.success('Restored as a new version'); },
    onError: (e) => toast.error(e.message),
  });
  const dup = useMutation({
    mutationFn: (v: VersionX) => api.post<{ id: string }>(`/projects/${card.projectId}/cards/${card.id}/duplicate`, { versionId: v.id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cards', card.projectId] }); toast.success('Duplicated as a new card'); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="px-2 py-2">
      {versions.map((v) => {
        const isCurrent = v.id === card.currentVersionId;
        const isApproved = v.id === card.approvedVersionId;
        const fb = feedback.filter((f) => f.versionId === v.id && f.kind === 'reject');
        return (
          <div key={v.id} className="group rounded-lg p-1.5 hoverable">
            <div className="flex gap-2">
              <button className="press w-[72px] shrink-0 overflow-hidden rounded" onClick={async () => {
                const { applyOverrides } = await import('@acs/renderer');
                const base = ctx.bundle.baseRev === v.defaultsRev ? ctx.bundle.base : (await api.get<{ base: typeof ctx.bundle.base }>(`/projects/${card.projectId}/revisions/${v.defaultsRev}`)).base;
                setPreview({ versionId: v.id, design: applyOverrides(base, v.overrides), label: `V${v.number}` });
              }} title="Preview in the canvas">
                <Thumb src={v.thumbUrl} aspect={v.width / v.height} pending={!v.thumbUrl} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[12.5px] font-medium">V{v.number}
                  {isCurrent ? <Badge>Current</Badge> : null}{isApproved ? <Badge tone="ok">Approved</Badge> : null}
                </div>
                <div className="line-clamp-2 text-[11.5px] text-muted">{v.reason}</div>
                <div className="text-[10.5px] text-faint">{ago(v.createdAt)} · {v.actor}{v.provider ? ` · ${v.provider}` : ''}</div>
              </div>
            </div>
            {v.prompt ? <div className="mt-1 line-clamp-2 rounded bg-hover px-1.5 py-1 text-[11px] text-muted" title={v.prompt}>“{v.prompt}”</div> : null}
            {fb.map((f) => <div key={f.id} className="mt-1 rounded bg-err-bg px-1.5 py-1 text-[11px] text-err">Rejected: {f.tags.join(', ')}{f.text ? ` — ${f.text}` : ''}</div>)}
            <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Button size="sm" variant="ghost" icon={<GitCompare className="size-3" />} onClick={() => setCompare(v)}>Compare</Button>
              {!isCurrent ? <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3" />} loading={restore.isPending} onClick={() => restore.mutate(v)}>Restore</Button> : null}
              <Button size="sm" variant="ghost" icon={<Copy className="size-3" />} onClick={() => dup.mutate(v)}>Duplicate</Button>
            </div>
          </div>
        );
      })}
      {compare ? <CompareDialog open onOpenChange={() => setCompare(null)} versions={versions} initialA={compare} /> : null}
    </div>
  );
}

