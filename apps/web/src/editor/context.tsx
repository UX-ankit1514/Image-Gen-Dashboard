import { createContext, useContext } from 'react';
import type { AssetX, CardBundle } from '../lib/types';
import type { Boxes } from './Canvas';

export interface EditorCtx {
  bundle: CardBundle;
  assets: Map<string, AssetX>;
  boxes: Boxes;
  pickImage: (purpose: 'background' | 'image-layer' | 'logo') => void;
  commit: (reason?: string, extra?: { prompt?: string; provider?: string }) => Promise<void>;
  openResize: () => void;
  focusText: (layerId: string) => void;
  /** The one AI action: generate a background. `canGenerate` is false until ChatGPT (image) is connected. */
  canGenerate: boolean;
  generateBackground: () => void;
}

export const EditorContext = createContext<EditorCtx | null>(null);

export function useEditorCtx() {
  const c = useContext(EditorContext);
  if (!c) throw new Error('EditorContext missing');
  return c;
}
