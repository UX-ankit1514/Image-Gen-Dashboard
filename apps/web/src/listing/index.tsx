/** The listing preview loads on demand: DialKit and Motion stay out of the first page load. */
import { lazy, Suspense, useEffect, useState, type ComponentProps } from 'react';
import { Spinner } from '../ui';

const ListingPreview = lazy(() => import('./ListingPreview'));

export type { ListingMedia, PreviewItem } from './ListingPreview';

export function LazyListingPreview(props: ComponentProps<typeof ListingPreview>) {
  return (
    <Suspense fallback={<div className="flex h-40 items-center justify-center rounded-xl border border-line bg-panel"><Spinner /></div>}>
      <ListingPreview {...props} />
    </Suspense>
  );
}

export interface LocalImage { file: File; url: string; width: number; height: number }

/** Object URLs and pixel sizes for picked files. URLs are made inside the effect so the cleanup that
 *  revokes them always pairs with the run that made them (StrictMode runs effects twice). */
export function useLocalImages(files: File[]) {
  const [list, setList] = useState<LocalImage[]>([]);
  useEffect(() => {
    let live = true;
    const urls = files.map((f) => URL.createObjectURL(f));
    setList([]);
    void Promise.all(files.map((file, i) => new Promise<LocalImage | null>((done) => {
      const img = new Image();
      img.onload = () => done({ file, url: urls[i], width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done(null);
      img.src = urls[i];
    }))).then((got) => { if (live) setList(got.filter((x): x is LocalImage => !!x)); });
    return () => { live = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [files]);
  return list;
}
