import { createContext, useContext } from 'react';
import type { BatchAction, Overrides, Scope } from '@acs/types';
import type { AssetX, CardBundle } from '../lib/types';
import type { Boxes } from './Canvas';

export interface EditorCtx {
  bundle: CardBundle;
  assets: Map<string, AssetX>;
  boxes: Boxes;
  pickImage: (purpose: 'background' | 'image-layer' | 'logo') => void;
  /** Apply a change beyond this card: selected cards, the whole project, or the project default. */
  applyBeyond: (scope: Exclude<Scope, 'card'>, op: BatchAction | { action: 'patch'; overrides: Overrides; reason: string }) => void;
  commit: (reason?: string, extra?: { prompt?: string; provider?: string }) => Promise<void>;
  openResize: () => void;
  focusText: (layerId: string) => void;
  aiAvailable: { text: boolean; vision: boolean; image: boolean; provider: string | null; planLabel: string | null };
  runAi: (text: string, opts?: { layerId?: string; intentHint?: string }) => void;
}

export const EditorContext = createContext<EditorCtx | null>(null);

export function useEditorCtx() {
  const c = useContext(EditorContext);
  if (!c) throw new Error('EditorContext missing');
  return c;
}
