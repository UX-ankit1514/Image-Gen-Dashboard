/**
 * Export = download. One click renders the cards' current versions and hands the file to the browser:
 * the image itself for one card, a ZIP of images for several. No dialog, no Exports page.
 */
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { api } from './api';
import { useBootstrap } from './queries';
import type { ExportX } from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The file name the browser will save, read from the signed URL's content-disposition. */
function fileName(url: string) {
  const d = new URL(url).searchParams.get('response-content-disposition') ?? '';
  return d.match(/filename="([^"]+)"/)?.[1] ?? null;
}

function save(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export type DownloadTarget = { cardIds: string[] } | 'all';

export function useDownload() {
  const { data: boot } = useBootstrap();
  const [busy, setBusy] = useState(false);

  /** Resolves to the saved file's name, or null when the download did not happen (the error is toasted). */
  const download = useCallback(async (projectId: string, target: DownloadTarget, count?: number): Promise<string | null> => {
    const id = toast.loading(count && count > 1 ? `Preparing ${count} images…` : 'Preparing your download…');
    setBusy(true);
    try {
      const rec = await api.post<ExportX>(`/projects/${projectId}/exports`, {
        scope: target === 'all' ? 'all' : target.cardIds.length === 1 ? 'current' : 'selected',
        cardIds: target === 'all' ? undefined : target.cardIds,
        format: boot?.workspace.settings.exportFormat ?? 'jpg',
        scale: 1,
      });
      const deadline = Date.now() + 10 * 60_000;
      for (;;) {
        await sleep(900);
        const e = await api.get<ExportX>(`/exports/${rec.id}`);
        if (e.status === 'completed') {
          const url = e.fileUrls.length === 1 ? e.fileUrls[0].url : e.zipUrl;
          if (!url) throw new Error('The file is not ready. Try again.');
          save(url);
          const name = fileName(url);
          toast.success(name ? `Downloaded ${name}` : 'Downloaded', { id });
          return name ?? 'your file';
        }
        if (e.status === 'failed') throw new Error(e.error ?? 'The export could not be made. Try again.');
        if (Date.now() > deadline) throw new Error('This is taking too long. Try again in a moment.');
      }
    } catch (err) {
      toast.error((err as Error).message, { id });
      return null;
    } finally {
      setBusy(false);
    }
  }, [boot]);

  return { download, busy };
}
