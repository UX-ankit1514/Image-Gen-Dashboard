/**
 * A dummy arnifi.com listing screen, drawn at real CSS pixels for a viewport width so the card image
 * sits in exactly the box the site gives it (see specs.ts). Only the image box is exact; the rest of
 * the page (header, filters, neighbouring cards) is a faithful sketch for context.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CardScene, type SrcResolver } from '@acs/renderer';
import type { Design } from '@acs/types';
import { cardWidth, imageBox, type ListingSpec, type Size } from './specs';

export type ListingMedia =
  | { kind: 'image'; src: string; width: number; height: number; name?: string }
  | { kind: 'design'; design: Design; resolveSrc: SrcResolver; name?: string; photo?: Size | null };

export const mediaSize = (m: ListingMedia): Size =>
  m.kind === 'image' ? { width: m.width, height: m.height } : { width: m.design.canvas.width, height: m.design.canvas.height };

const NAVY = '#171752';
const FONT: CSSProperties = { fontFamily: 'Inter, sans-serif', WebkitFontSmoothing: 'antialiased' };

/** The media in a w×h box the way the site draws it: object-fit cover, centred. */
export function MediaFill({ media, w, h, sceneRef }: { media: ListingMedia; w: number; h: number; sceneRef?: (el: HTMLDivElement | null) => void }) {
  if (media.kind === 'image') {
    return <img src={media.src} alt="" draggable={false} style={{ width: w, height: h, objectFit: 'cover', objectPosition: '50% 50%', display: 'block', maxWidth: 'none' }} />;
  }
  const { width: cw, height: ch } = media.design.canvas;
  const s = Math.max(w / cw, h / ch);
  return (
    <div style={{ position: 'relative', width: w, height: h, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: (w - cw * s) / 2, top: (h - ch * s) / 2, width: cw, height: ch, transform: `scale(${s})`, transformOrigin: '0 0' }}>
        <CardScene design={media.design} resolveSrc={media.resolveSrc} rootRef={sceneRef} />
      </div>
    </div>
  );
}

interface Copy { kicker?: string; title: string; meta?: string; time?: string; price: string; country?: string }

const SAMPLE: Record<ListingSpec['id'], Copy[]> = {
  licence: [
    { kicker: 'IFZA', title: 'IFZA License and Visa Quota Package', meta: '826 activities available', price: 'AED 12,900' },
    { kicker: 'Dubai Mainland', title: 'Dubai - Mainland License (Standard Professional Activity)', meta: '2,325 activities available', price: 'AED 22,005' },
    { kicker: 'RAKEZ', title: 'RAKEZ - Biz Saver Plus One', meta: '3,621 activities available', price: 'AED 14,010' },
  ],
  visa: [
    { kicker: 'IFZA', title: 'IFZA Employment Visa Outside Country', meta: 'An IFZA out-of-country employment visa is issued to individuals currently residing outside the UAE.', time: '15-20 days', price: 'AED 654.36' },
    { kicker: 'SHAMS', title: 'SHAMS Employment Visa Outside Country', meta: 'A SHAMS out-of-country employment visa is designed for individuals residing outside the UAE.', time: '15-20 days', price: 'AED 1,454.36' },
    { kicker: 'SHAMS', title: 'SHAMS Employment Visa Inside Country', meta: 'SHAMS in-country employment visa allows individuals already residing in the UAE to be sponsored.', time: '15-20 days', price: 'AED 2,154.36' },
  ],
  postsetup: [
    { title: 'UAE Mainland - Activity Addition', time: '7–14 working days', price: 'AED 2,000', country: 'UAE' },
    { title: 'Malaysia Corporate Compliance and Tax Services', time: '3-4 Days', price: 'USD 6,869', country: 'Malaysia' },
    { title: 'D-U-N-S Number Registration Service', time: '10 Working days', price: 'USD 800', country: 'BVI' },
  ],
};

function UaeFlag({ w = 24, h = 16 }: { w?: number; h?: number }) {
  return (
    <span style={{ display: 'inline-flex', width: w, height: h, flex: 'none', borderRadius: 2, overflow: 'hidden', boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,.15)' }}>
      <span style={{ width: w / 4, background: '#ef3340' }} />
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <span style={{ flex: 1, background: '#009739' }} /><span style={{ flex: 1, background: '#fff' }} /><span style={{ flex: 1, background: '#111' }} />
      </span>
    </span>
  );
}

function Clock() {
  return <span style={{ width: 18, height: 18, borderRadius: 9, background: NAVY, flex: 'none', display: 'inline-block', boxShadow: 'inset 0 0 0 4px #171752, inset 0 0 0 5px #fff' }} />;
}

function Placeholder({ w, h }: { w: number; h: number }) {
  return <div style={{ width: w, height: h, background: 'rgba(23,23,82,0.06)' }} />;
}

/** Outline of the full image box drawn above the card body, so the part hidden under it is visible. */
function BoxGuide({ w, h, covered }: { w: number; h: number; covered: number }) {
  if (!covered) return null;
  return (
    <div style={{ position: 'absolute', left: 1, top: 1, width: w, height: h, pointerEvents: 'none', zIndex: 3 }}>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: covered, border: '1.5px dashed #e8590c', background: 'repeating-linear-gradient(135deg, rgba(232,89,12,.16) 0 4px, transparent 4px 9px)' }} />
    </div>
  );
}

export interface CardMockProps {
  spec: ListingSpec;
  vw: number;
  /** null draws the grey loading box the site shows before an image arrives */
  media: ListingMedia | null;
  hover: boolean;
  guides: boolean;
  copy?: Partial<Copy>;
  index?: number;
  sceneRef?: (el: HTMLDivElement | null) => void;
}

/** One listing card at real CSS size. */
export function CardMock({ spec, vw, media, hover, guides, copy, index = 0, sceneRef }: CardMockProps) {
  const w = cardWidth(spec.layout, vw);
  const box = imageBox(spec, vw);
  const c = { ...SAMPLE[spec.id][index % 3], ...copy };
  const desk = vw >= 900;
  const hovering = hover && desk;
  const cover = spec.cover(vw);
  const image = media ? <MediaFill media={media} w={box.w} h={box.h} sceneRef={sceneRef} /> : <Placeholder w={box.w} h={box.h} />;

  if (spec.id === 'licence') {
    return (
      <div style={{ ...FONT, width: w, position: 'relative', background: '#fff', border: '1px solid rgba(0,0,0,.12)', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 'none' }}>
        <div style={{ position: 'relative', borderRadius: '8px 8px 0 0', overflow: 'hidden', background: 'rgba(23,23,82,0.06)' }}>
          {image}
          <div style={{ position: 'absolute', top: 0, right: 0, background: '#fff', padding: 5, display: 'flex', alignItems: 'center', gap: 4, borderTopRightRadius: 8, borderBottomLeftRadius: 8 }}>
            <UaeFlag /><span style={{ fontSize: 12, fontWeight: 500, lineHeight: '18px', color: '#464645' }}>UAE</span>
          </div>
        </div>
        <div style={{ position: 'relative', background: '#fff', padding: desk ? '16px 18px' : '12px 16px', transform: hovering ? 'translateY(-60px)' : undefined, transition: 'transform 300ms ease-in-out', marginBottom: hovering ? -60 : 0 }}>
          <div style={{ fontSize: desk ? 14 : 12, lineHeight: '21px', fontWeight: 500, color: 'rgba(23,23,82,.5)', letterSpacing: 0.42 }}>{c.kicker}</div>
          <div style={{ fontSize: desk ? 16 : 14, lineHeight: desk ? '22px' : '20px', height: desk ? 44 : 40, fontWeight: 500, color: NAVY, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.title}</div>
          <div style={{ marginTop: 5, fontSize: 14, lineHeight: '21px', fontWeight: 500, color: '#7070ff' }}>{c.meta}</div>
          <div style={{ margin: desk ? '10px 0' : '8px 0', borderTop: '1.5px solid rgba(0,0,0,.12)' }} />
          <div style={{ marginTop: 10, fontSize: 14, lineHeight: '18px', fontWeight: 500, color: 'rgba(11,11,41,.4)' }}>starting from</div>
          <div style={{ fontSize: 18, lineHeight: '24px', fontWeight: 600, color: NAVY }}>{c.price}</div>
          {hovering ? <div style={{ marginTop: 12, height: 44, borderRadius: 1.5, background: '#3939cc', color: '#fff', fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>View Details</div> : null}
        </div>
      </div>
    );
  }

  const badge = spec.id === 'visa' ? (
    <div style={{ position: 'absolute', right: 0, top: 0, zIndex: 2, background: '#f7f5f2', borderRadius: '0 4px 0 8px', padding: '6px 12px', display: 'flex', gap: 5, alignItems: 'center' }}>
      <UaeFlag w={18} h={14} /><span style={{ fontSize: 14, fontWeight: 600, lineHeight: '20px', color: 'rgba(23,23,82,.5)' }}>UAE</span>
    </div>
  ) : (
    <div style={{ position: 'absolute', right: 0, top: 0, zIndex: 2, background: '#fff', padding: 5, display: 'flex', gap: 4, alignItems: 'center', borderTopRightRadius: 4, borderBottomLeftRadius: 4 }}>
      <UaeFlag /><span style={{ fontSize: 12, fontWeight: 500, lineHeight: '18px', color: '#464645' }}>{index ? c.country : 'UAE'}</span>
    </div>
  );
  const time = (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14, lineHeight: '21px', fontWeight: 500, color: '#525252' }}>
      <Clock /><span>Estimated time <b style={{ fontWeight: 600, color: NAVY }}>{c.time}</b></span>
    </div>
  );
  const price = (
    <>
      <div style={{ margin: '8px 0 14px', height: 2, background: 'rgba(23,23,82,0.06)' }} />
      <div style={{ fontSize: 14, lineHeight: '21px', fontWeight: 500, color: '#878d96' }}>starting from</div>
      <div style={{ fontSize: 18, lineHeight: '24px', fontWeight: 600, color: NAVY }}>{c.price}</div>
    </>
  );
  const button = <div style={{ marginTop: 10, height: 44, borderRadius: 1.5, background: '#d6d6ff', color: '#0b0b29', fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>View Detail</div>;

  if (spec.id === 'visa') {
    const top = hovering ? 57 : 120;
    return (
      <div style={{ ...FONT, width: w, position: 'relative', background: '#fff', border: '1px solid #e0e0e0', borderRadius: 4, overflow: 'hidden', minHeight: 360, flex: 'none', display: 'flex', flexDirection: 'column' }}>
        {badge}
        <div style={{ height: box.h, overflow: 'hidden', borderRadius: '4px 4px 0 0' }}>{image}</div>
        <div style={{ background: '#fff', padding: desk ? '14px 18px 20px' : '14px 18px 16px', ...(desk ? { position: 'absolute', left: 0, top, width: '100%', height: 320, transition: 'top 300ms ease-in-out' } : { position: 'relative' }) }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: 0.5, fontSize: 12, fontWeight: 500, color: NAVY }}><span style={{ width: 14, height: 14, borderRadius: 7, background: '#c9c9d6' }} />Employee</span>
            <span style={{ fontSize: 13, lineHeight: '20px', fontWeight: 500, color: '#343a3f', padding: '4px 12px', borderRadius: 2, background: '#f5f5ff' }}>{c.kicker}</span>
          </div>
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 16, lineHeight: '24px', fontWeight: 600, color: '#262626', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</div>
            <div style={{ margin: '6px 0 18px', fontSize: 13, lineHeight: '20px', color: '#8d8d8d', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.meta}</div>
          </div>
          {time}{price}
          {hovering || !desk ? button : null}
        </div>
        {guides && media && !hovering ? <BoxGuide w={box.w} h={box.h} covered={cover.rest} /> : null}
      </div>
    );
  }

  return (
    <div style={{ ...FONT, width: w, position: 'relative', background: '#fff', border: '1px solid #e0e0e0', borderRadius: 4, overflow: 'hidden', minHeight: 360, flex: 'none', display: 'flex', flexDirection: 'column' }}>
      {badge}
      <div style={{ height: box.h, overflow: 'hidden', borderRadius: '4px 4px 0 0' }}>{image}</div>
      <div style={{ position: 'relative', background: '#fff', padding: desk ? '14px 18px 20px' : '14px 18px 16px' }}>
        <div style={{ margin: '0 0 16px', fontSize: 16, lineHeight: '24px', fontWeight: 600, color: '#262626', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</div>
        {time}{price}{button}
      </div>
    </div>
  );
}

function TopBar({ vw, spec }: { vw: number; spec: ListingSpec }) {
  const desk = vw >= 1200;
  const pad = desk ? (spec.layout === 'business' ? 60 : 40) : 16;
  const nav = ['Start your Business', 'Locations', 'Services', 'Tools', 'Partner', 'Resources', 'Contact'];
  return (
    <>
      <div style={{ height: desk ? 38 : 32, background: '#ededfb', display: 'flex', alignItems: 'flex-end', paddingLeft: desk ? pad + 90 : pad, fontSize: 13, color: NAVY }}>
        {['Arnifi', 'Arni AI', 'Arnifi HR'].map((t, i) => <span key={t} style={{ padding: '0 16px', height: desk ? 38 : 32, display: 'flex', alignItems: 'center', background: i === 0 ? '#fff' : undefined, fontWeight: i === 0 ? 500 : 400 }}>{t}</span>)}
      </div>
      <div style={{ height: desk ? 88 : 64, display: 'flex', alignItems: 'center', gap: 28, padding: `0 ${pad}px`, borderBottom: '1px solid #f0f0f4' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#2b2ba6', fontSize: desk ? 28 : 22, fontWeight: 500, letterSpacing: -0.5 }}>
          <span style={{ fontSize: desk ? 24 : 18 }}>✧</span>Arnifi
        </span>
        {vw >= 1100 ? (
          <>
            <span style={{ display: 'flex', gap: 30, marginLeft: 50, fontSize: 13.5, color: '#55556a' }}>{nav.map((n) => <span key={n}>{n}</span>)}</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ width: 40, height: 40, border: '1px solid #e2e2ea', borderRadius: 4 }} />
              <span style={{ width: 40, height: 40, border: '1px solid #e2e2ea', borderRadius: 4 }} />
              <span style={{ height: 52, width: 260, background: '#2a2aa3', borderRadius: 2, color: '#fff', fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', paddingLeft: 24 }}>Partner Dashboard</span>
            </span>
          </>
        ) : <span style={{ marginLeft: 'auto', width: 26, height: 16, borderTop: `2px solid ${NAVY}`, borderBottom: `2px solid ${NAVY}`, position: 'relative' }}><span style={{ position: 'absolute', left: 0, right: 0, top: 5, borderTop: `2px solid ${NAVY}` }} /></span>}
      </div>
      {spec.layout === 'services' ? (
        <div style={{ height: 48, background: '#f4f4fd', display: 'flex', alignItems: 'center', gap: 28, padding: `0 ${pad}px`, fontSize: 13, fontWeight: 500, color: NAVY, whiteSpace: 'nowrap', overflow: 'hidden' }}>
          {['Post-Setup Compliance', 'Visa Services', 'Attestation', 'Accounting & Bookkeeping', 'Legal Service', 'Product Registration & Certification', 'Liquidation', 'Banking Services', 'Will Drafting'].map((s) => (
            <span key={s} style={{ color: s === spec.page ? '#3939cc' : undefined }}>{s}</span>
          ))}
        </div>
      ) : null}
    </>
  );
}

function Bar({ w, h = 10, c = '#ececf2', r = 3, style }: { w: number | string; h?: number; c?: string; r?: number; style?: CSSProperties }) {
  return <div style={{ width: w, height: h, background: c, borderRadius: r, ...style }} />;
}

function Sidebar({ spec }: { spec: ListingSpec }) {
  const rows = spec.layout === 'business' ? ['IFZA', 'RAKEZ', 'SHAMS', 'Ajman Free Zone', 'Innovation City', 'SPC Free Zone', 'Dubai Mainland', 'DMCC'] : ['Employee', 'Family', 'Professional', 'Meydan', 'DIFC', 'DMCC', 'SHAMS', 'SPC'];
  return (
    <div style={{ fontSize: 13, color: NAVY, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {spec.layout === 'business' ? (
        <>
          <div style={{ fontWeight: 600 }}>Country <span style={{ color: '#9a9ab0', fontWeight: 400 }}>(12)</span></div>
          <div style={{ height: 46, border: '1px solid #e2e2ea', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px' }}><UaeFlag w={18} h={12} />UAE</div>
          <div style={{ fontWeight: 600, marginTop: 8 }}>Jurisdiction <span style={{ color: '#9a9ab0', fontWeight: 400 }}>(28)</span></div>
        </>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>Filters<span style={{ color: '#d22', fontSize: 11 }}>CLEAR ALL</span></div>
      )}
      {rows.map((r) => <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#3c3c55' }}><span style={{ width: 16, height: 16, border: '1.5px solid #c8c8d4', borderRadius: 3 }} />{r}</div>)}
    </div>
  );
}

/** The listing page at `vw` CSS px wide, showing the first row of cards; the first card is yours. */
export function ListingScreen({ spec, vw, media, hover, guides, copy, mark = true }: {
  spec: ListingSpec; vw: number; media: ListingMedia; hover: boolean; guides: boolean; copy?: Partial<Copy>; mark?: boolean;
}) {
  const desk = vw >= 1200;
  const cols = vw >= 900 ? 3 : 1;
  const margin = desk ? (spec.layout === 'business' ? 60 : 40) : spec.layout === 'services' && vw >= 900 ? 40 : 0;
  const inset = desk ? (spec.layout === 'business' ? 30 : 40) : 24;
  const avail = vw - margin * 2;
  const mainW = desk ? 0.8 * avail : avail;
  const sideW = desk ? 0.2 * avail : 0;
  const cards: ReactNode[] = [];
  for (let i = 0; i < (cols === 3 ? 3 : 2); i++) {
    cards.push(
      <div key={i} style={{ position: 'relative' }}>
        {i === 0 && mark ? <div style={{ position: 'absolute', inset: -5, border: '2.5px solid #3b5bdb', borderRadius: 10, pointerEvents: 'none', zIndex: 4 }} /> : null}
        <CardMock spec={spec} vw={vw} media={i === 0 ? media : null} hover={i === 0 && hover} guides={i === 0 && guides} copy={i === 0 ? copy : undefined} index={i} />
      </div>,
    );
  }
  return (
    <div style={{ ...FONT, width: vw, background: '#fff', color: NAVY }}>
      <TopBar vw={vw} spec={spec} />
      {spec.layout === 'business' ? (
        <div style={{ padding: desk ? `34px ${margin + 0.2 * avail + inset}px 0` : '24px 24px 0', fontFamily: 'Lora, serif', fontSize: desk ? 28 : 22, color: '#7070ff', fontWeight: 500 }}>{spec.page}</div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: desk ? 'row' : 'column', margin: `0 ${margin}px`, paddingTop: 24 }}>
        {desk ? <div style={{ width: sideW, flex: 'none', paddingTop: 8 }}><Sidebar spec={spec} /></div> : (
          <div style={{ margin: '0 24px 4px', height: 44, border: '1px solid #e2e2ea', borderRadius: 4, display: 'flex', alignItems: 'center', padding: '0 14px', fontSize: 13, fontWeight: 600 }}>Filters</div>
        )}
        <div style={{ width: mainW, paddingLeft: inset, paddingRight: desk ? 0 : 24, flex: 'none', boxSizing: 'border-box' }}>
          {spec.layout === 'services' ? (
            <div style={{ height: 60, borderRadius: 4, background: '#e8f1fb', border: '1px solid #d3e3f6', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16, marginBottom: 20 }}>
              <div style={{ flex: 1 }}><Bar w="55%" h={10} c="#c7d6ea" /><Bar w="75%" h={8} c="#d8e3f1" style={{ marginTop: 8 }} /></div>
              {vw >= 900 ? <span style={{ height: 34, width: 150, background: '#222', borderRadius: 3 }} /> : null}
            </div>
          ) : (
            <div style={{ height: 48, border: '1px solid #e8e8ee', borderRadius: 4, marginBottom: 18, display: 'flex', alignItems: 'center', padding: '0 14px', color: '#a0a0b4', fontSize: 13 }}>Search for any activity name, keywords …</div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, fontSize: 12.5 }}>
            <span style={{ height: 34, padding: '0 14px', borderRadius: 17, background: '#f2f2f6', display: 'flex', alignItems: 'center' }}>Sort by: <b style={{ marginLeft: 4 }}>Best Sellers</b></span>
            <span style={{ marginLeft: 'auto', color: '#55556a' }}>{spec.layout === 'business' ? 'Showing 9 out of 64 packages' : 'Result · 20 Packages'}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: cols === 3 ? 'row' : 'column', gap: 16, alignItems: 'flex-start' }}>{cards}</div>
        </div>
      </div>
    </div>
  );
}

/** Scales a fixed-width child to the container's width and clips it to `maxHeight` (in child px). */
export function FitWidth({ width, maxHeight, children, className }: { width: number; maxHeight?: number; children: ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const ro = new ResizeObserver(() => setSize({ w: o.clientWidth, h: i.offsetHeight }));
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);
  const s = size.w ? size.w / width : 0;
  const h = Math.min(size.h, maxHeight ?? Infinity);
  return (
    <div ref={outer} className={className} style={{ position: 'relative', overflow: 'hidden', height: s ? h * s : 0 }}>
      <div ref={inner} style={{ width, transform: `scale(${s})`, transformOrigin: '0 0', position: 'absolute', left: 0, top: 0 }}>{children}</div>
    </div>
  );
}
