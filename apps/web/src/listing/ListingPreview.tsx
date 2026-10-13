/**
 * "How it looks on arnifi.com": the card in a dummy listing screen, at its actual size, on a crop map,
 * with a size check. The listing, screen width, hover state and guides live in a DialKit panel; the
 * three listing tabs flip on hover too. Values are shared (DialKit panel id) by every preview in the
 * session, so the listing you last looked at stays selected across pages and dialogs.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DialRoot, useDialKitController } from 'dialkit';
import 'dialkit/styles.css';
import { AlertTriangle, Check, CircleAlert, MonitorSmartphone } from 'lucide-react';
import { cx } from '../ui';
import { CardMock, ListingScreen, MediaFill, mediaSize, type ListingMedia } from './ListingMock';
import {
  assess, cardWidth, deviceById, DEVICES, imageBox, LISTINGS, listingById, place, safeArea,
  type Assessment, type LayerBox, type ListingId, type Placement, type Rect, type Size, type Verdict,
} from './specs';

export type { ListingMedia } from './ListingMock';

export interface PreviewItem { key: string; label: string; media: ListingMedia; thumb?: string | null }

const DIAL = {
  listing: { type: 'select' as const, options: LISTINGS.map((l) => ({ value: l.id, label: l.label })), default: 'licence' },
  screen: { type: 'select' as const, options: DEVICES.map((d) => ({ value: d.id, label: d.label })), default: 'desktop' },
  hoverState: false,
  cropGuides: true,
};

const LAYER_LABEL: Record<string, string> = { logo: 'Logo', headline: 'Headline', subheading: 'First line' };

/** Logo and text boxes of a design, in canvas px, measured from a rendered CardScene. */
function useLayerBoxes(media: ListingMedia) {
  const root = useRef<HTMLDivElement | null>(null);
  const [boxes, setBoxes] = useState<LayerBox[] | null>(null);
  const measure = useCallback(() => {
    const el = root.current;
    if (!el || media.kind !== 'design') return;
    const r0 = el.getBoundingClientRect();
    const k = r0.width / media.design.canvas.width;
    if (!k) return;
    const out: LayerBox[] = [];
    for (const l of media.design.layers) {
      if (!l.visible || (l.type !== 'logo' && l.type !== 'text') || (l.type === 'text' && !l.text.trim())) continue;
      const node = el.querySelector(`[data-layer-id="${CSS.escape(l.id)}"]`);
      if (!node) continue;
      const r = node.getBoundingClientRect();
      out.push({
        id: l.id, label: LAYER_LABEL[l.id] ?? l.name, important: l.type === 'logo' || l.role !== 'body',
        rect: { x: (r.left - r0.left) / k, y: (r.top - r0.top) / k, w: r.width / k, h: r.height / k },
      });
    }
    setBoxes(out);
  }, [media]);
  useLayoutEffect(() => { measure(); }, [measure]);
  useEffect(() => {
    void document.fonts?.ready.then(measure);
    const t = setTimeout(measure, 350);
    return () => clearTimeout(t);
  }, [measure]);
  const ref = useCallback((el: HTMLDivElement | null) => { root.current = el; }, []);
  return { boxes: media.kind === 'design' ? boxes : null, ref };
}

/** Available width of a block, for scaling fixed-size mocks into it. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** A fixed-width child drawn at `scale` (callers cap it at 1, so mocks never upscale). */
function Scaled({ width, scale: s, children }: { width: number; scale: number; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div style={{ width: width * s, height: h * s, position: 'relative', overflow: 'hidden' }}>
      <div ref={inner} style={{ width, position: 'absolute', left: 0, top: 0, transform: `scale(${s})`, transformOrigin: '0 0' }}>{children}</div>
    </div>
  );
}

const TONE: Record<Verdict, { dot: string; chip: string; icon: ReactNode; word: string }> = {
  good: { dot: 'bg-ok', chip: 'bg-ok-bg text-ok', icon: <Check className="size-3.5" />, word: 'Good fit' },
  warn: { dot: 'bg-warn', chip: 'bg-warn-bg text-warn', icon: <CircleAlert className="size-3.5" />, word: 'Works, with limits' },
  bad: { dot: 'bg-err', chip: 'bg-err-bg text-err', icon: <AlertTriangle className="size-3.5" />, word: 'Not a good fit' },
};

function CropMap({ media, src, p, safe, layers, sceneRef, width }: {
  media: ListingMedia; src: Size; p: Placement; safe: Rect; layers: Assessment['layers'];
  sceneRef: (el: HTMLDivElement | null) => void; width: number;
}) {
  const h = (width * src.height) / src.width;
  const r = p.rest;
  return (
    <div className="relative overflow-hidden rounded-md bg-hover" style={{ width, height: h }}>
      <MediaFill media={media} w={width} h={h} sceneRef={sceneRef} />
      <svg viewBox={`0 0 ${src.width} ${src.height}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full" aria-hidden>
        <path fillRule="evenodd" fill="rgba(14,12,40,.62)" d={`M0 0H${src.width}V${src.height}H0Z M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}Z`} />
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {p.hover ? <rect x={p.hover.x} y={p.hover.y} width={p.hover.w} height={p.hover.h} fill="none" stroke="#ffc53d" strokeWidth={1.5} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" /> : null}
        {safe.w > 0 && safe.h > 0 ? <rect x={safe.x} y={safe.y} width={safe.w} height={safe.h} fill="none" stroke="#5eead4" strokeWidth={1.5} strokeDasharray="1.5 3" vectorEffect="non-scaling-stroke" /> : null}
        {layers.map((l) => {
          const b = l.rect;
          return <rect key={l.id} x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke={l.rest === 'visible' ? '#69db7c' : '#ff6b6b'} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
    </div>
  );
}

export default function ListingPreview({ items, title, className, initialKey }: {
  items: PreviewItem[];
  /** The card's title in the mock (headline, card or file name). */
  title?: string;
  className?: string;
  initialKey?: string;
}) {
  const dial = useDialKitController('Preview settings', DIAL, { id: 'listing-preview', shortcuts: { hoverState: { key: 'h' }, cropGuides: { key: 'g' } } });
  const v = dial.values;
  const spec = listingById(v.listing);
  const device = deviceById(v.screen);
  const [activeKey, setActiveKey] = useState(initialKey ?? items[0]?.key);
  const item = items.find((i) => i.key === activeKey) ?? items[0];
  useEffect(() => { if (initialKey) setActiveKey(initialKey); }, [initialKey]);

  const media = item?.media;
  const src = media ? mediaSize(media) : { width: 1, height: 1 };
  const { boxes, ref: sceneRef } = useLayerBoxes(media ?? { kind: 'image', src: '', width: 1, height: 1 });
  const all = useMemo(() => LISTINGS.map((l) => assess(l, device, src, boxes)), [device, src.width, src.height, boxes]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = all[LISTINGS.indexOf(spec)];
  const p = place(spec, device.vw, src);
  const safe = safeArea(spec, src);

  // hover the tabs to flip listings (a short intent delay so sweeping across them doesn't flicker)
  const intent = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pick = (id: ListingId) => { if (id !== v.listing) dial.setValue('listing', id); };
  const hoverPick = (id: ListingId) => {
    if (intent.current) clearTimeout(intent.current);
    intent.current = setTimeout(() => pick(id), 90);
  };
  useEffect(() => () => { if (intent.current) clearTimeout(intent.current); }, []);

  const [screenRef, screenW] = useWidth<HTMLDivElement>();
  const [cardRef, cardAvail] = useWidth<HTMLDivElement>();
  const [mapRef, mapAvail] = useWidth<HTMLDivElement>();
  if (!media) return null;
  const box = imageBox(spec, device.vw);
  const cw = cardWidth(spec.layout, device.vw);
  const screenScale = screenW > 2 ? Math.min(1, (screenW - 2) / device.vw) : 0;
  const cardScale = cardAvail > 12 ? Math.min(1, (cardAvail - 12) / cw) : 0;
  const copy = title ? { title } : undefined;
  const photo = media.kind === 'design' && media.photo ? media.photo : null;
  const photoFill = photo ? Math.max(src.width / photo.width, src.height / photo.height) : 1;

  return (
    <section className={cx('@container rounded-xl border border-line bg-panel', className)} data-testid="listing-preview">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3.5">
        <MonitorSmartphone className="size-4 text-muted" />
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold">How it looks on arnifi.com</div>
          <div className="truncate text-[11.5px] text-muted">{spec.url} · {device.label}</div>
        </div>
        {items.length > 1 ? (
          <div className="ml-auto flex max-w-full gap-1.5 overflow-x-auto scroll-quiet" role="listbox" aria-label="Image to preview">
            {items.map((it) => (
              <button key={it.key} role="option" aria-selected={it.key === item.key} title={it.label} onClick={() => setActiveKey(it.key)}
                className={cx('press h-9 w-14 shrink-0 overflow-hidden rounded-md border bg-hover', it.key === item.key ? 'border-ink shadow-[0_0_0_1px_#111]' : 'border-line hover:border-line-strong')}>
                {it.thumb ? <img src={it.thumb} alt="" className="size-full object-cover" /> : <span className="text-[11px] text-muted">{it.label}</span>}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <div role="tablist" aria-label="Listing page" className="mx-4 mt-3 grid grid-cols-3 gap-1 rounded-lg bg-hover p-1"
        onMouseLeave={() => { if (intent.current) clearTimeout(intent.current); }}
        onKeyDown={(e) => {
          const i = LISTINGS.indexOf(spec);
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const next = LISTINGS[(i + (e.key === 'ArrowRight' ? 1 : LISTINGS.length - 1)) % LISTINGS.length];
            pick(next.id);
            (e.currentTarget.querySelector(`[data-listing="${next.id}"]`) as HTMLElement | null)?.focus();
          }
        }}>
        {LISTINGS.map((l, i) => {
          const sel = l.id === spec.id;
          const b = imageBox(l, device.vw);
          return (
            <button key={l.id} role="tab" aria-selected={sel} tabIndex={sel ? 0 : -1} data-listing={l.id}
              onMouseEnter={() => hoverPick(l.id)} onFocus={() => pick(l.id)} onClick={() => pick(l.id)}
              className={cx('flex min-w-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors duration-100', sel ? 'bg-panel shadow-[var(--shadow-card)]' : 'hover:bg-panel/60')}>
              <span className={cx('size-2 shrink-0 rounded-full', TONE[all[i].verdict].dot)} aria-label={TONE[all[i].verdict].word} />
              <span className="min-w-0">
                <span className={cx('block truncate text-[12.5px]', sel ? 'font-semibold' : 'font-medium text-muted')}>{l.label}</span>
                <span className="block text-[11px] text-faint tabular-nums">{Math.round(b.w)} × {Math.round(b.h)} box</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 p-4 @3xl:grid-cols-[minmax(0,1fr)_228px]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* the dummy screen */}
          <div ref={screenRef} className="flex justify-center">
            <div className="overflow-hidden rounded-lg border border-line-strong bg-white shadow-[var(--shadow-card)]" style={{ width: screenScale ? device.vw * screenScale + 2 : '100%' }}>
              <div className="flex h-7 items-center gap-1.5 border-b border-line bg-[#f3f3f5] px-2.5">
                <span className="size-2 rounded-full bg-[#ff5f57]" /><span className="size-2 rounded-full bg-[#febc2e]" /><span className="size-2 rounded-full bg-[#28c840]" />
                <span className="mx-2 min-w-0 flex-1 truncate rounded bg-white px-2 py-0.5 text-center text-[10.5px] text-muted">{spec.url}</span>
                <span className="hidden text-[10.5px] text-faint tabular-nums @md:inline">{device.vw}px</span>
              </div>
              <Scaled width={device.vw} scale={screenScale}>
                <ListingScreen spec={spec} vw={device.vw} media={media} hover={v.hoverState} guides={v.cropGuides} copy={copy} />
              </Scaled>
            </div>
          </div>

          <div className="grid gap-4 @xl:grid-cols-[auto_minmax(0,1fr)]">
            <figure className="flex min-w-0 flex-col gap-2">
              <figcaption className="text-[12px] font-medium">Actual size <span className="font-normal text-muted">· {Math.round(box.w)} × {Math.round(box.h)} image box</span></figcaption>
              <div ref={cardRef} style={{ maxWidth: cw + 12 }} className="w-full">
                <div className="rounded-lg bg-canvas p-1.5">
                  <Scaled width={cw} scale={cardScale}>
                    <CardMock spec={spec} vw={device.vw} media={media} hover={v.hoverState} guides={v.cropGuides} copy={copy} />
                  </Scaled>
                </div>
              </div>
            </figure>

            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cx('inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-medium', TONE[a.verdict].chip)}>{TONE[a.verdict].icon}{TONE[a.verdict].word}</span>
                <span className="text-[13px] font-semibold">{a.title}</span>
              </div>
              <div ref={mapRef} className="w-full">
                {v.cropGuides ? (
                  <>
                    <CropMap media={media} src={src} p={p} safe={safe} layers={a.layers} sceneRef={sceneRef} width={Math.min(mapAvail || 280, 360)} />
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                      <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-3.5 border-[1.5px] border-ink/70" />Visible</span>
                      {p.hover ? <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-3.5 border-[1.5px] border-dashed border-[#e0a100]" />On hover</span> : null}
                      <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-3.5 border-[1.5px] border-dotted border-[#14b8a6]" />Safe on every screen</span>
                      {boxes?.length ? <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-3.5 border-[1.5px] border-[#e03131]" />Cut off</span> : null}
                    </div>
                  </>
                ) : (
                  // keep a hidden scene mounted so logo and text boxes can still be measured
                  <div className="pointer-events-none absolute -left-[9999px] opacity-0" aria-hidden><MediaFill media={media} w={320} h={(320 * src.height) / src.width} sceneRef={sceneRef} /></div>
                )}
              </div>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
                {a.facts.map((f) => (
                  <div key={f.label} className="contents">
                    <dt className="text-muted">{f.label}</dt>
                    <dd className={cx(f.tone === 'warn' && 'text-warn', f.tone === 'err' && 'text-err', f.tone === 'ok' && 'text-ok')}>{f.value}</dd>
                  </div>
                ))}
                {photo && photoFill > 1.05 ? (
                  <div className="contents"><dt className="text-muted">Photo</dt><dd className="text-warn">{photo.width} × {photo.height} px, stretched {photoFill.toFixed(1)}× to fill the card: it will look soft</dd></div>
                ) : null}
                {a.layers.length ? (
                  <div className="contents">
                    <dt className="text-muted">On the card</dt>
                    <dd>{a.layers.map((l, i) => (
                      <span key={l.id}>{i ? ' · ' : ''}{l.label} <span className={l.rest === 'visible' ? 'text-ok' : 'text-err'}>{l.rest === 'visible' ? 'visible' : l.rest === 'cut' ? 'cut off' : 'hidden'}</span></span>
                    ))}</dd>
                  </div>
                ) : null}
              </dl>
              <div>
                <div className="mb-1 text-[12px] font-semibold">What to change</div>
                <ul className="flex list-disc flex-col gap-1 pl-4 text-[12px] leading-snug text-ink/85">{a.tips.map((t) => <li key={t}>{t}</li>)}</ul>
              </div>
            </div>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-2">
          <div className="dialkit-host overflow-hidden rounded-lg border border-line" data-testid="listing-dialkit">
            <DialRoot mode="inline" theme="light" productionEnabled />
          </div>
          <p className="text-[11px] leading-snug text-faint">Hover a tab to flip listings, or use ← → on the tabs. Press <b className="font-medium text-muted">H</b> for the hover state and <b className="font-medium text-muted">G</b> for crop guides.</p>
        </aside>
      </div>
    </section>
  );
}
