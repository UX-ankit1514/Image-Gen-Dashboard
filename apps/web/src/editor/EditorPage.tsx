/**
 * The Card Editor (PRD §18). Autosave is debounced and silent (§65): the working state is saved as a
 * draft within a second of each change and turned into a named version at meaningful moments — on
 * ⌘S, after a pause, when leaving, or before review actions. Undo/redo is session-local (§66).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Cloud, CloudOff, Download, Loader2, Minus, Plus, Redo2, ThumbsDown, ThumbsUp, Undo2 } from 'lucide-react';
import { diffOverrides, resizeDesign } from '@acs/renderer';
import type { BatchAction, RejectTag, Scope } from '@acs/types';
import { api } from '../lib/api';
import { builtinUrl } from '../lib/builtins';
import type { AssetX, CardBundle } from '../lib/types';
import { Button, cx, IconButton, Kbd, Menu, MenuItem, MenuSeparator, Spinner, StatusPill } from '../ui';
import { AssetPicker } from '../components/AssetPicker';
import { ExportDialog } from '../components/ExportDialog';
import { RejectDialog } from '../components/RejectDialog';
import { ResizeDialog, type ResizeChoice } from '../components/ResizeDialog';
import { EditorCanvas, type Boxes } from './Canvas';
import { EditorContext, type EditorCtx } from './context';
import { Inspector } from './inspector/Inspector';
import { deleteOrHide, duplicateLayers, LeftPanel } from './LeftPanel';
import { useEditor } from './store';
import { GenerateDialog } from './ai/GenerateDialog';
import { PromptBar } from './ai/PromptBar';
import { pickProvider, planLabel, useConnections } from './ai/useAi';

const IDLE_COMMIT_MS = 20_000;

export function EditorPage() {
  const { pid = '', cid = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: bundle, error, refetch } = useQuery({ queryKey: ['card', cid], queryFn: () => api.get<CardBundle>(`/projects/${pid}/cards/${cid}`), refetchOnWindowFocus: false });
  const design = useEditor((s) => s.design);
  const saveState = useEditor((s) => s.saveState);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const zoom = useEditor((s) => s.zoom);
  const [boxes, setBoxes] = useState<Boxes>({});
  const [assets, setAssets] = useState<Map<string, AssetX>>(new Map());
  const [dialog, setDialog] = useState<null | 'resize' | 'reject' | 'export' | 'generate' | 'edit-bg' | { pick: 'background' | 'image-layer' | 'logo' }>(null);
  const [aiPreset, setAiPreset] = useState<{ text: string; layerId?: string; intentHint?: string; nonce: number } | null>(null);
  const [genPrompt, setGenPrompt] = useState('');
  const loadedFor = useRef<string | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data: conns } = useConnections();

  // load / reload the card into the store (keeps unsaved local edits when the server echoes back)
  useEffect(() => {
    if (!bundle) return;
    setAssets(new Map(bundle.assets.map((a) => [a.id, a])));
    const st = useEditor.getState();
    const key = `${bundle.card.id}:${bundle.card.currentVersionId}:${bundle.baseRev}`;
    if (loadedFor.current === key && st.cardId === bundle.card.id) return;
    if (st.cardId === bundle.card.id && st.saveState !== 'saved' && loadedFor.current?.startsWith(bundle.card.id)) {
      st.rebase(bundle.base, bundle.baseRev);
    } else {
      st.load(bundle.card.id, bundle.design, bundle.base, bundle.baseRev);
    }
    loadedFor.current = key;
  }, [bundle]);

  // ---------------------------------------------------------------- autosave + commit
  const saveDraft = useCallback(async () => {
    const s = useEditor.getState();
    if (!s.design || !s.base || !s.baseRev || s.saveState === 'saved' || s.cardId !== cid) return;
    s.setSave('saving');
    try {
      await api.put(`/projects/${pid}/cards/${cid}/draft`, { draft: diffOverrides(s.base, s.design), baseRev: s.baseRev });
      if (useEditor.getState().saveState === 'saving') useEditor.getState().setSave('saved');
    } catch (e) {
      useEditor.getState().setSave('error');
      toast.error(`Couldn't save: ${(e as Error).message}`);
    }
  }, [pid, cid]);

  const commit = useCallback(async (reason?: string, extra: { prompt?: string; provider?: string } = {}) => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    await saveDraft();
    try {
      const r = await api.post<{ created: boolean; version: { number: number } }>(`/projects/${pid}/cards/${cid}/commit`, { reason, prompt: extra.prompt ?? null, provider: extra.provider ?? null });
      if (r.created) {
        qc.invalidateQueries({ queryKey: ['card', cid] });
        qc.invalidateQueries({ queryKey: ['cards', pid] });
      }
      return;
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [saveDraft, pid, cid, qc]);

  useEffect(() => {
    if (saveState !== 'dirty') return;
    const t = setTimeout(saveDraft, 800);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => { void commit(); }, IDLE_COMMIT_MS);
    return () => clearTimeout(t);
  }, [design, saveState, saveDraft, commit]);

  // leaving: save and commit with keepalive so a closing tab still persists (PRD §77)
  useEffect(() => {
    const flush = () => {
      const s = useEditor.getState();
      if (!s.design || !s.base || !s.baseRev || s.saveState === 'saved') return;
      const headers = { 'content-type': 'application/json', 'x-acs': '1' };
      void fetch(`/api/projects/${pid}/cards/${cid}/draft`, { method: 'PUT', keepalive: true, headers, body: JSON.stringify({ draft: diffOverrides(s.base, s.design), baseRev: s.baseRev }) })
        .then(() => fetch(`/api/projects/${pid}/cards/${cid}/commit`, { method: 'POST', keepalive: true, headers, body: '{}' }));
    };
    window.addEventListener('beforeunload', flush);
    return () => { window.removeEventListener('beforeunload', flush); flush(); };
  }, [pid, cid]);

  // ---------------------------------------------------------------- review actions
  const approve = useMutation({
    mutationFn: async () => { await saveDraft(); return api.post(`/projects/${pid}/cards/${cid}/approve`); },
    onSuccess: () => { toast.success('Approved'); refetch(); qc.invalidateQueries({ queryKey: ['cards', pid] }); },
    onError: (e) => toast.error(e.message),
  });
  const reject = useMutation({
    mutationFn: async ({ tags, text }: { tags: RejectTag[]; text: string }) => { await saveDraft(); return api.post(`/projects/${pid}/cards/${cid}/reject`, { tags, text }); },
    onSuccess: () => { toast.success('Rejected: feedback saved for regeneration'); setDialog(null); refetch(); qc.invalidateQueries({ queryKey: ['cards', pid] }); },
    onError: (e) => toast.error(e.message),
  });
  const batch = useMutation({
    mutationFn: (b: { scope: Exclude<Scope, 'card'>; op: BatchAction }) => api.post<{ changed: number; skippedApproved: number }>(`/projects/${pid}/batch`, { cardIds: [cid], scope: b.scope, op: b.op }),
    onSuccess: (r) => { toast.success(`${r.changed} card${r.changed === 1 ? '' : 's'} updated${r.skippedApproved ? ` · ${r.skippedApproved} approved left as they are` : ''}`); refetch(); qc.invalidateQueries({ queryKey: ['cards', pid] }); },
    onError: (e) => toast.error(e.message),
  });

  const doResize = async (c: ResizeChoice) => {
    await commit();                                   // the previous size is kept as its own version
    useEditor.getState().apply((d) => resizeDesign(d, c.width, c.height, c.mode, c.fit));
    await commit(`Resized to ${c.width} × ${c.height} (${c.mode === 'scale' ? 'scaled' : c.mode === 'keep' ? 'kept sizes' : 'reflowed'})`);
    setDialog(null);
    requestAnimationFrame(() => (window as unknown as { __acsCanvas?: { fit: () => void } }).__acsCanvas?.fit());
  };

  // ---------------------------------------------------------------- keyboard (PRD §75) — never animated
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void commit(); }
        return;
      }
      const s = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) { s.redo(); } else { s.undo(); } return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); return; }
      if (mod && e.key === 's') { e.preventDefault(); void commit().then(() => toast.success('Saved as a version')); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateLayers(s.selection); return; }
      if (e.key === 'Escape') { s.select([]); s.setPreview(null); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { if (s.selection.length) { e.preventDefault(); deleteOrHide(s.selection); } return; }
      const canvas = (window as unknown as { __acsCanvas?: { fit: () => void; zoomTo: (z: number) => void } }).__acsCanvas;
      if (e.key === '0' && !mod) { canvas?.fit(); return; }
      if (e.key === '1' && !mod) { canvas?.zoomTo(1); return; }
      if ((e.key === '=' || e.key === '+') && !mod) { canvas?.zoomTo(s.zoom * 1.25); return; }
      if (e.key === '-' && !mod) { canvas?.zoomTo(s.zoom / 1.25); return; }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.key] && s.selection.length && s.design) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const [dx, dy] = arrows[e.key].map((v) => v * step);
        const patches: Record<string, Record<string, unknown>> = {};
        for (const l of s.design.layers.filter((x) => s.selection.includes(x.id) && !x.locked)) {
          if (l.type === 'background') patches[l.id] = { offsetX: l.offsetX + dx, offsetY: l.offsetY + dy };
          else if (l.type === 'gradient' || (l.type === 'text' && l.stackOn)) continue;
          else patches[l.id] = { x: l.x + dx, y: l.y + dy };
        }
        s.updateLayers(patches, 'nudge');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit]);

  // paste an image straight in as the background (PRD §16)
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea')) return;
      const f = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))?.getAsFile();
      if (!f) return;
      try {
        const a = await api.upload<AssetX>(`/projects/${pid}/assets`, new File([f], `pasted-${Date.now()}.png`, { type: f.type }), { purpose: 'screenshot' });
        setAssets((m) => new Map(m).set(a.id, a));
        useEditor.getState().apply((d) => ({ ...d, layers: d.layers.map((l) => (l.type === 'background' ? { ...l, assetId: a.id, source: 'uploaded', visible: true, focalX: 0.5, focalY: 0.42, zoom: 1, offsetX: 0, offsetY: 0 } : l)) }));
        toast.success('Pasted image is now the background');
      } catch (err) { toast.error((err as Error).message); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [pid]);

  const resolveSrc = useCallback((ref: string) => {
    if (ref.startsWith('builtin:')) return builtinUrl(ref);
    const a = assets.get(ref);
    return a ? (a.width > 2000 ? a.previewUrl : a.url) ?? a.url : null;
  }, [assets]);

  // assets referenced by the design that the bundle didn't include (picked from the library)
  useEffect(() => {
    if (!design) return;
    const missing = design.layers.flatMap((l) => (l.type === 'background' || l.type === 'image') && l.assetId && !assets.has(l.assetId) ? [l.assetId] : l.type === 'logo' && !l.src.startsWith('builtin:') && !assets.has(l.src) ? [l.src] : []);
    if (!missing.length) return;
    void api.post<AssetX[]>('/assets/resolve', { ids: missing }).then((list) => setAssets((m) => { const n = new Map(m); for (const a of list) n.set(a.id, a); return n; }));
  }, [design, assets]);

  const project = bundle?.project;
  const textConn = pickProvider(conns, project?.provider ?? 'auto', 'textGeneration');
  const visionConn = pickProvider(conns, project?.provider ?? 'auto', 'visionAnalysis');
  const imageConn = pickProvider(conns, project?.provider ?? 'auto', 'imageGeneration');

  const ctx: EditorCtx | null = useMemo(() => bundle ? ({
    bundle, assets, boxes,
    pickImage: (purpose) => setDialog({ pick: purpose }),
    applyBeyond: (scope, op) => batch.mutate({ scope, op: op as BatchAction }),
    commit,
    openResize: () => setDialog('resize'),
    focusText: (id) => { useEditor.getState().select([id]); setTimeout(() => document.getElementById(`text-${id}`)?.focus(), 30); },
    aiAvailable: { text: !!textConn, vision: !!visionConn, image: !!imageConn, provider: textConn?.provider ?? imageConn?.provider ?? null, planLabel: planLabel(textConn ?? imageConn) },
    runAi: (text, opts = {}) => {
      if (opts.intentHint === 'GENERATE_BACKGROUND' || opts.intentHint === 'GENERATE_VARIATIONS') { setGenPrompt(text); setDialog('generate'); return; }
      if (opts.intentHint === 'EDIT_BACKGROUND') { setGenPrompt(text); setDialog('edit-bg'); return; }
      setAiPreset({ text: opts.intentHint === 'PROMPT' ? '' : text, layerId: opts.layerId, intentHint: opts.intentHint === 'PROMPT' ? undefined : opts.intentHint, nonce: Date.now() });
    },
  }) : null, [bundle, assets, boxes, commit, batch, textConn, visionConn, imageConn]);

  if (error) return <div className="flex h-full flex-col items-center justify-center gap-3 text-[14px]"><AlertTriangle className="size-6 text-warn" />{(error as Error).message}<Link to={`/p/${pid}`}><Button>Back to the project</Button></Link></div>;
  if (!bundle || !ctx || !design) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  const card = bundle.card;
  const approvedV = bundle.versions.find((v) => v.id === card.approvedVersionId);

  return (
    <EditorContext.Provider value={ctx}>
      <div className="flex h-full flex-col bg-canvas">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
          <IconButton label="Back to the project" onClick={() => navigate(`/p/${pid}`)}><ArrowLeft className="size-4" /></IconButton>
          <div className="flex min-w-0 items-center gap-2">
            <Link to={`/p/${pid}`} className="hidden truncate text-[13px] text-muted hover:text-ink md:block">{project?.name}</Link>
            <span className="text-faint">/</span>
            <span className="truncate text-[13.5px] font-semibold" data-testid="card-name">{card.name}</span>
            <StatusPill status={card.status} />
            {approvedV && approvedV.id !== card.currentVersionId ? <span className="text-[11.5px] text-muted">Approved: V{approvedV.number}</span> : null}
          </div>
          <SaveIndicator />
          <div className="mx-auto flex items-center gap-1">
            <IconButton label="Undo (⌘Z)" disabled={!past} onClick={() => useEditor.getState().undo()}><Undo2 className="size-4" /></IconButton>
            <IconButton label="Redo (⇧⌘Z)" disabled={!future} onClick={() => useEditor.getState().redo()}><Redo2 className="size-4" /></IconButton>
            <div className="mx-1 h-5 w-px bg-line" />
            <button className="press flex h-8 items-center gap-1 rounded-md px-2 text-[12.5px] tabular-nums hoverable" onClick={() => setDialog('resize')} data-testid="canvas-size">
              <span className="text-muted">W</span>{design.canvas.width}<span className="ml-1.5 text-muted">H</span>{design.canvas.height}
            </button>
            <div className="mx-1 h-5 w-px bg-line" />
            <IconButton size="sm" label="Zoom out (−)" onClick={() => (window as any).__acsCanvas?.zoomTo(zoom / 1.25)}><Minus className="size-3.5" /></IconButton>
            <Menu align="center" trigger={<button className="press h-7 min-w-14 rounded-md px-1.5 text-[12.5px] tabular-nums hoverable">{Math.round(zoom * 100)}%<ChevronDown className="ml-0.5 inline size-3 text-muted" /></button>}>
              <MenuItem onSelect={() => (window as any).__acsCanvas?.fit()} shortcut="0">Fit</MenuItem>
              <MenuItem onSelect={() => (window as any).__acsCanvas?.zoomTo(0.5)}>50%</MenuItem>
              <MenuItem onSelect={() => (window as any).__acsCanvas?.zoomTo(1)} shortcut="1">100%</MenuItem>
              <MenuItem onSelect={() => (window as any).__acsCanvas?.zoomTo(2)}>200%</MenuItem>
            </Menu>
            <IconButton size="sm" label="Zoom in (+)" onClick={() => (window as any).__acsCanvas?.zoomTo(zoom * 1.25)}><Plus className="size-3.5" /></IconButton>
          </div>
          <Button size="sm" variant="ghost" icon={<ThumbsDown className="size-3.5" />} onClick={() => setDialog('reject')}>Reject</Button>
          <Button size="sm" variant={card.status === 'approved' && card.approvedVersionId === card.currentVersionId && saveState === 'saved' ? 'subtle' : 'secondary'} icon={<ThumbsUp className="size-3.5" />} loading={approve.isPending} onClick={() => approve.mutate()} data-testid="approve">
            {card.status === 'approved' && card.approvedVersionId === card.currentVersionId && saveState === 'saved' ? 'Approved' : 'Approve'}
          </Button>
          <Menu trigger={<Button size="sm" variant="primary" icon={<Download className="size-3.5" />}>Export</Button>}>
            <MenuItem onSelect={() => setDialog('export')}>Export this card…</MenuItem>
            <MenuSeparator />
            <MenuItem onSelect={() => void commit().then(() => toast.success('Saved as a version'))} shortcut="⌘S">Save a version now</MenuItem>
          </Menu>
        </header>

        <div className="flex min-h-0 flex-1">
          <LeftPanel />
          <div className="flex min-w-0 flex-1 flex-col">
            <EditorCanvas resolveSrc={resolveSrc} onBoxes={setBoxes} onTextDoubleClick={(id) => ctx.focusText(id)}
              assetSize={(id) => { const a = id ? assets.get(id) : null; return a && a.width ? { width: a.width, height: a.height } : null; }} />
            <PromptBar presetText={aiPreset} />
          </div>
          <Inspector />
        </div>
        <div className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-[11px] text-faint">
          <span><Kbd>⌘Z</Kbd> undo</span><span><Kbd>⇧</Kbd>+<Kbd>←</Kbd> nudge 10</span><span><Kbd>⌘D</Kbd> duplicate</span><span><Kbd>0</Kbd> fit</span><span><Kbd>1</Kbd> 100%</span><span><Kbd>Space</Kbd> pan</span><span><Kbd>Alt</Kbd> no snapping</span>
          <span className="ml-auto">{bundle.versions.length} versions</span>
        </div>
      </div>

      {dialog === 'resize' ? <ResizeDialog open onOpenChange={() => setDialog(null)} initial={{ width: design.canvas.width, height: design.canvas.height }} onResize={doResize} /> : null}
      {dialog === 'reject' ? <RejectDialog open onOpenChange={() => setDialog(null)} busy={reject.isPending} onReject={(tags, text) => reject.mutate({ tags, text })} /> : null}
      {dialog === 'export' ? <ExportDialog open onOpenChange={() => setDialog(null)} projectId={pid} cardIds={[cid]} defaultScope="current" namingTemplate={project?.namingTemplate} /> : null}
      {dialog === 'generate' || dialog === 'edit-bg' ? <GenerateDialog open onOpenChange={() => setDialog(null)} projectId={pid} cardIds={[cid]} initialPrompt={genPrompt} mode={dialog === 'edit-bg' ? 'edit' : 'generate'}
        onUsed={() => { loadedFor.current = null; void refetch(); }} /> : null}
      {dialog && typeof dialog === 'object' ? (
        <AssetPicker open onOpenChange={() => setDialog(null)} projectId={pid} title={dialog.pick === 'logo' ? 'Choose a logo' : dialog.pick === 'image-layer' ? 'Add an image layer' : 'Replace the background'}
          onPick={(a) => {
            setAssets((m) => new Map(m).set(a.id, a));
            const s = useEditor.getState();
            if (dialog.pick === 'background') {
              s.apply((d) => ({ ...d, layers: d.layers.map((l) => (l.type === 'background' ? { ...l, assetId: a.id, source: a.source === 'website' ? 'website' : a.source === 'generated' ? 'generated' : a.projectId ? 'project' : 'uploaded', visible: true, focalX: 0.5, focalY: 0.42, zoom: 1, offsetX: 0, offsetY: 0 } : l)) }));
              void commit('Background replaced');
            } else if (dialog.pick === 'logo') {
              const logo = s.design?.layers.find((l) => l.type === 'logo');
              if (logo) s.updateLayer(logo.id, { src: a.id, color: null, height: Math.round(logo.width * (a.height / Math.max(1, a.width))) } as never);
            } else {
              const W = s.design!.canvas.width;
              const w = Math.round(W * 0.3);
              const id = `image_${Date.now().toString(36)}`;
              s.apply((d) => ({ ...d, layers: [...d.layers, { id, name: a.name, type: 'image', assetId: a.id, fit: 'cover', visible: true, locked: false, x: W * 0.6, y: 80, width: w, height: Math.round(w * (a.height / Math.max(1, a.width))), rotation: 0, opacity: 1 }] }));
              s.select([id]);
            }
            setDialog(null);
          }} />
      ) : null}
    </EditorContext.Provider>
  );
}

function SaveIndicator() {
  const state = useEditor((s) => s.saveState);
  return (
    <span className={cx('ml-1 inline-flex items-center gap-1 text-[11.5px]', state === 'error' ? 'text-err' : 'text-faint')} data-testid="save-state">
      {state === 'saving' ? <><Loader2 className="size-3 animate-spin" />Saving…</> : state === 'dirty' ? <><Cloud className="size-3" />Edited</> : state === 'error' ? <><CloudOff className="size-3" />Not saved</> : <><Check className="size-3" />Saved</>}
    </span>
  );
}

