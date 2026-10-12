/**
 * Editor state (PRD §65–66). The design is the full resolved Design; persistence stores only its
 * difference from the project base. Undo/redo is session-local snapshots (designs are a few KB);
 * long-term restoration is the version history.
 */
import { create } from 'zustand';
import type { Design, Layer } from '@acs/types';

const MAX_HISTORY = 200;

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

interface EditorState {
  cardId: string | null;
  design: Design | null;
  base: Design | null;
  baseRev: string | null;
  selection: string[];
  past: Design[];
  future: Design[];
  /** history entries coalesce while the same key repeats (a drag, a slider scrub) */
  lastKey: string | null;
  lastAt: number;
  saveState: SaveState;
  savedAt: number | null;
  zoom: number;
  pan: { x: number; y: number };
  /** a version being previewed read-only in the canvas */
  previewing: { versionId: string; design: Design; label: string } | null;
  version: number;

  load(cardId: string, design: Design, base: Design, baseRev: string): void;
  rebase(base: Design, baseRev: string): void;
  apply(fn: (d: Design) => Design, key?: string): void;
  updateLayer(id: string, patch: Partial<Layer>, key?: string): void;
  updateLayers(patches: Record<string, Partial<Layer>>, key?: string): void;
  checkpoint(): void;
  undo(): void;
  redo(): void;
  select(ids: string[]): void;
  setSave(s: SaveState): void;
  setView(zoom: number, pan?: { x: number; y: number }): void;
  setPreview(p: EditorState['previewing']): void;
}

export const useEditor = create<EditorState>((set, get) => ({
  cardId: null, design: null, base: null, baseRev: null, selection: [], past: [], future: [], lastKey: null, lastAt: 0,
  saveState: 'saved', savedAt: null, zoom: 0.5, pan: { x: 0, y: 0 }, previewing: null, version: 0,

  load: (cardId, design, base, baseRev) => set({ cardId, design, base, baseRev, selection: [], past: [], future: [], lastKey: null, saveState: 'saved', previewing: null, version: get().version + 1 }),
  rebase: (base, baseRev) => set({ base, baseRev }),

  apply: (fn, key) => {
    const { design, past, lastKey, lastAt } = get();
    if (!design) return;
    const next = fn(design);
    if (next === design) return;
    const now = Date.now();
    const coalesce = key && key === lastKey && now - lastAt < 1200;
    set({
      design: next,
      past: coalesce ? past : [...past, design].slice(-MAX_HISTORY),
      future: [],
      lastKey: key ?? null,
      lastAt: now,
      saveState: 'dirty',
      previewing: null,
    });
  },

  updateLayer: (id, patch, key) => get().apply((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)) }), key),
  updateLayers: (patches, key) => get().apply((d) => ({ ...d, layers: d.layers.map((l) => (patches[l.id] ? ({ ...l, ...patches[l.id] } as Layer) : l)) }), key),

  /** ends coalescing, so the next change starts a new undo step (pointer-up, blur) */
  checkpoint: () => set({ lastKey: null }),

  undo: () => {
    const { past, design, future } = get();
    if (!past.length || !design) return;
    set({ design: past[past.length - 1], past: past.slice(0, -1), future: [design, ...future].slice(0, MAX_HISTORY), lastKey: null, saveState: 'dirty', previewing: null });
  },
  redo: () => {
    const { past, design, future } = get();
    if (!future.length || !design) return;
    set({ design: future[0], future: future.slice(1), past: [...past, design].slice(-MAX_HISTORY), lastKey: null, saveState: 'dirty', previewing: null });
  },

  select: (ids) => set({ selection: ids }),
  setSave: (s) => set({ saveState: s, savedAt: s === 'saved' ? Date.now() : get().savedAt }),
  setView: (zoom, pan) => set({ zoom: Math.min(8, Math.max(0.05, zoom)), ...(pan ? { pan } : {}) }),
  setPreview: (p) => set({ previewing: p }),
}));

export const selectedLayers = (s: EditorState) => (s.design?.layers ?? []).filter((l) => s.selection.includes(l.id));
