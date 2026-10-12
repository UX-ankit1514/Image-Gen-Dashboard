import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import { cx } from '../ui';

/** Thumbnails only, lazy-loaded (PRD §76): never a full-resolution file in a grid. */
export function Thumb({ src, aspect = 1.6, className, alt = '', pending }: { src?: string | null; aspect?: number; className?: string; alt?: string; pending?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className={cx('relative w-full overflow-hidden bg-[#ececec]', className)} style={{ aspectRatio: String(aspect) }}>
      {src && !failed ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
          className={cx('absolute inset-0 size-full object-cover transition-opacity duration-200', loaded ? 'opacity-100' : 'opacity-0')} />
      ) : null}
      {!loaded && (pending || (src && !failed)) ? <div className="skeleton absolute inset-0" /> : null}
      {!src && !pending ? <div className="absolute inset-0 flex items-center justify-center text-faint"><ImageOff className="size-5" /></div> : null}
      {failed ? <div className="absolute inset-0 flex items-center justify-center text-faint"><ImageOff className="size-5" /></div> : null}
    </div>
  );
}
