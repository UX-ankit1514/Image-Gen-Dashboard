/** A routed intent → the smallest design change (PRD §31). Pure; used for the preview and the apply. */
import { applyGradientPatch, resizeDesign, updateLayer } from '@acs/renderer';
import type { BackgroundLayer, Design, Layer, RouterResult, TextLayer } from '@acs/types';

export function applyRouted(d: Design, r: RouterResult, imageSize?: { width: number; height: number } | null): Design {
  switch (r.intent) {
    case 'EDIT_GRADIENT':
      return r.gradient ? applyGradientPatch(d, r.gradient) : d;
    case 'CHANGE_DIMENSIONS':
      return r.dimensions ? resizeDesign(d, r.dimensions.width, r.dimensions.height, 'scale', 'cover') : d;
    case 'EDIT_COPY': {
      if (!r.copy) return d;
      const l = d.layers.find((x) => x.id === r.copy!.layerId) as TextLayer | undefined;
      return l ? updateLayer(d, l.id, { text: r.copy.text, provenance: { ...l.provenance, kind: r.source === 'ai' ? 'ai' : 'manual', original: l.provenance.original ?? l.text } } as Partial<TextLayer>) : d;
    }
    case 'CHANGE_LAYOUT':
    case 'REPOSITION_LAYER': {
      let out = d;
      for (const m of r.layout?.moves ?? []) {
        const l = out.layers.find((x) => x.id === m.layerId);
        if (!l) continue;
        if (l.type === 'background' && (m.dx || m.dy)) {
          const bg = l as BackgroundLayer;
          if (imageSize && bg.zoom === 1 && bg.fit === 'cover') {
            const scale = Math.max(bg.width / imageSize.width, bg.height / imageSize.height);
            const ox = imageSize.width * scale - bg.width;
            const oy = imageSize.height * scale - bg.height;
            const clamp = (v: number) => Math.min(1, Math.max(0, v));
            out = updateLayer(out, bg.id, {
              focalX: ox > 0.5 ? +clamp(bg.focalX - (m.dx ?? 0) / ox).toFixed(4) : bg.focalX,
              focalY: oy > 0.5 ? +clamp(bg.focalY - (m.dy ?? 0) / oy).toFixed(4) : bg.focalY,
            } as Partial<BackgroundLayer>);
          } else {
            out = updateLayer(out, bg.id, { offsetX: bg.offsetX + (m.dx ?? 0), offsetY: bg.offsetY + (m.dy ?? 0) } as Partial<BackgroundLayer>);
          }
          continue;
        }
        const p: Partial<Layer> & Record<string, unknown> = {};
        if (m.visible !== undefined) p.visible = m.visible;
        if (m.dx) p.x = Math.round(l.x + m.dx);
        if (m.dy) p.y = Math.round(l.y + m.dy);
        if (m.x !== undefined) p.x = m.x;
        if (m.y !== undefined) p.y = m.y;
        if (m.width !== undefined) {
          p.width = m.width;
          if (l.type === 'logo' && l.keepAspect) p.height = Math.round(m.width * (l.height / l.width));
        }
        if (m.fontSize !== undefined && l.type === 'text') { p.fontSize = m.fontSize; p.autoSize = null; }
        if (l.type === 'text' && l.stackOn && (m.dx || m.dy)) {
          // a stacked key line moves by detaching from the heading flow
          p.stackOn = null;
        }
        out = updateLayer(out, l.id, p);
      }
      return out;
    }
    default:
      return d;
  }
}
