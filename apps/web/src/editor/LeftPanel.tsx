/** Left panel: Layers, and the card's earlier versions. */
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Eye, EyeOff, Image as ImageIcon, Lock, MoreHorizontal, Palette, Plus, RotateCcw, Shapes, Sparkles, Square, Trash2, Type, Unlock } from 'lucide-react';
import { newId } from '@acs/shared';
import type { Layer, ShapeLayer, TextLayer } from '@acs/types';
import { api } from '../lib/api';
import { ago } from '../lib/format';
import type { VersionX } from '../lib/types';
import { useEditor } from './store';
import { useEditorCtx } from './context';
import { Badge, Button, cx, IconButton, Menu, MenuItem, MenuSeparator, Tab, TabList, TabPanel, Tabs } from '../ui';
import { Thumb } from '../components/Thumb';

const ICON: Record<Layer['type'], React.ReactNode> = {
  background: <ImageIcon className="size-3.5" />, gradient: <Palette className="size-3.5" />, logo: <Sparkles className="size-3.5" />,
  text: <Type className="size-3.5" />, shape: <Square className="size-3.5" />, image: <ImageIcon className="size-3.5" />,
};

export function LeftPanel() {
  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-panel">
      <Tabs defaultValue="layers" className="flex min-h-0 flex-1 flex-col">
        <div className="px-3 pt-3"><TabList><Tab value="layers">Layers</Tab><Tab value="history">History</Tab></TabList></div>
        <TabPanel value="layers" className="min-h-0 flex-1 overflow-y-auto scroll-quiet"><LayersPanel /></TabPanel>
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
            <span className="min-w-0 flex-1 truncate">{l.id === 'subheading' ? 'First line' : l.name}</span>
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
    </div>
  );
}

function HistoryPanel() {
  const ctx = useEditorCtx();
  const { card, versions } = ctx.bundle;
  const setPreview = useEditor((s) => s.setPreview);
  const qc = useQueryClient();
  const restore = useMutation({
    mutationFn: (v: VersionX) => api.post(`/projects/${card.projectId}/cards/${card.id}/restore/${v.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['card', card.id] }); toast.success('Restored as a new version'); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="px-2 py-2">
      {versions.map((v) => {
        const isCurrent = v.id === card.currentVersionId;
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
                <div className="flex items-center gap-1.5 text-[12.5px] font-medium">V{v.number}{isCurrent ? <Badge>Current</Badge> : null}</div>
                <div className="line-clamp-2 text-[11.5px] text-muted">{v.reason}</div>
                <div className="text-[10.5px] text-faint">{ago(v.createdAt)}</div>
              </div>
            </div>
            {!isCurrent ? (
              <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3" />} loading={restore.isPending} onClick={() => restore.mutate(v)}>Restore</Button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
