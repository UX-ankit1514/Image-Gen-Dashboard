/**
 * New Project (PRD §12): six decisions on one page, every one pre-filled, so creating a project takes
 * a name and a link. A live preview shows the recipe, size and layers before anything is created.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clipboard, FileUp, FolderInput, Globe, Layers, Link2, PenSquare } from 'lucide-react';
import { buildRecipe, CardScene, updateLayer } from '@acs/renderer';
import type { CreateProjectBody, InputType, LayerToggles, Scan, TextLayer } from '@acs/types';
import { api } from '../lib/api';
import { builtinUrl } from '../lib/builtins';
import { useBootstrap } from '../lib/queries';
import { PageHeader } from '../shell/AppShell';
import { Button, cx, Field, Input, Switch, Textarea } from '../ui';
import { readLegacyFolder, type LegacyFolder } from './importLegacy';

const INPUTS: { value: InputType; label: string; icon: React.ReactNode; hint: string }[] = [
  { value: 'url', label: 'Webpage / section URL', icon: <Link2 className="size-4" />, hint: 'One Arnifi page, listing or service section.' },
  { value: 'urls', label: 'Multiple URLs', icon: <Globe className="size-4" />, hint: 'One link per line.' },
  { value: 'upload', label: 'Upload images', icon: <FileUp className="size-4" />, hint: 'PNG, JPG or WebP. One card per image.' },
  { value: 'screenshot', label: 'Paste screenshot', icon: <Clipboard className="size-4" />, hint: 'Paste from the clipboard.' },
  { value: 'import', label: 'Import existing folder', icon: <FolderInput className="size-4" />, hint: 'A folder from a previous card run (data.json + images/).' },
  { value: 'blank', label: 'Start blank', icon: <PenSquare className="size-4" />, hint: 'One empty card.' },
];

const LAYERS: { key: keyof LayerToggles; label: string }[] = [
  { key: 'background', label: 'Background' }, { key: 'gradient', label: 'Gradient' }, { key: 'logo', label: 'Logo' },
  { key: 'headline', label: 'Heading' }, { key: 'subheading', label: 'Subheading' },
];

const PROVIDERS = [
  { value: 'auto', label: 'Automatic', hint: 'Use whichever connected AI can do the job.' },
  { value: 'chatgpt', label: 'ChatGPT', hint: 'Your ChatGPT plan, via the local companion.' },
  { value: 'claude', label: 'Claude', hint: 'Your Claude plan, via the local companion.' },
  { value: 'none', label: 'None', hint: 'Everything still works without AI.' },
] as const;

export function NewProjectPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: boot } = useBootstrap();
  const [name, setName] = useState('');
  const [input, setInput] = useState<InputType>((params.get('input') as InputType) || 'url');
  const [url, setUrl] = useState(params.get('url') ?? '');
  const [urls, setUrls] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [shot, setShot] = useState<File | null>(null);
  const [folder, setFolder] = useState<LegacyFolder | null>(null);
  const [recipeId, setRecipeId] = useState('arnifi-light');
  const [dim, setDim] = useState({ width: 1600, height: 1000, custom: false });
  const [layers, setLayers] = useState<LayerToggles>({ background: true, gradient: true, logo: true, headline: true, subheading: true });
  const [provider, setProvider] = useState<CreateProjectBody['provider']>('auto');
  const [progress, setProgress] = useState<string | null>(null);
  const nameTouched = useRef(false);

  // a sensible default name from the link or the folder
  useEffect(() => {
    if (nameTouched.current) return;
    if (input === 'url' && url) {
      try {
        const u = new URL(url.startsWith('http') ? url : `https://${url}`);
        const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
        setName(last.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').replace(/^Product Listing$/, 'Product listing'));
      } catch { /* typing */ }
    }
    if (input === 'import' && folder) setName(folder.name);
  }, [url, input, folder]);

  // screenshots: paste anywhere on the page
  useEffect(() => {
    if (input !== 'screenshot') return;
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const f = item?.getAsFile();
      if (f) setShot(new File([f], `screenshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`, { type: f.type }));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [input]);

  const recipe = boot?.recipes.find((r) => r.id === recipeId);
  useEffect(() => {
    if (recipe && !dim.custom) setDim({ width: recipe.width, height: recipe.height, custom: false });
  }, [recipeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(() => {
    let d = buildRecipe(boot?.recipes.find((r) => r.id === recipeId)?.builtin === false ? 'arnifi-light' : recipeId, dim.width, dim.height);
    d = updateLayer(d, 'headline', { text: name || 'Ireland Company Setup' } as Partial<TextLayer>);
    d = updateLayer(d, 'subheading', { text: 'Fast and efficient setup' } as Partial<TextLayer>);
    d = { ...d, canvas: { ...d.canvas, background: '#5b6aa8' }, layers: d.layers.map((l) => (l.id in layers ? { ...l, visible: layers[l.id as keyof LayerToggles] } : l)) };
    return d;
  }, [recipeId, dim.width, dim.height, layers, name, boot]);

  const ready = name.trim() && (
    (input === 'url' && url.trim()) || (input === 'urls' && urls.trim()) || (input === 'upload' && files.length) ||
    (input === 'screenshot' && shot) || (input === 'import' && folder?.records.length) || input === 'blank');

  const create = useMutation({
    mutationFn: async () => {
      const body: CreateProjectBody = {
        name: name.trim(), inputType: input, recipeId, width: dim.width, height: dim.height, layers, provider,
        urls: input === 'url' ? [url.trim()] : input === 'urls' ? urls.split(/\s+/).map((u) => u.trim()).filter(Boolean) : undefined,
      };
      setProgress('Creating project');
      const { project, scan } = await api.post<{ project: { id: string }; scan: Scan | null }>('/projects', body);
      const pid = project.id;
      if (input === 'upload' || input === 'screenshot') {
        const list = input === 'upload' ? files : [shot!];
        for (let i = 0; i < list.length; i++) {
          setProgress(`Uploading ${i + 1} of ${list.length}`);
          const a = await api.upload<{ id: string; name: string }>(`/projects/${pid}/assets`, list[i], { purpose: input === 'screenshot' ? 'screenshot' : 'upload' });
          await api.post(`/projects/${pid}/cards/blank`, { name: a.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' '), backgroundAssetId: a.id, headline: '', subheading: '' });
        }
        return { to: `/p/${pid}` };
      }
      if (input === 'import' && folder) {
        const { importFolder } = await import('./importLegacy');
        await importFolder(pid, folder, setProgress);
        return { to: `/p/${pid}` };
      }
      if (input === 'blank') {
        const card = await api.post<{ id: string }>(`/projects/${pid}/cards/blank`, { name: 'Untitled card', headline: name.trim(), subheading: '' });
        return { to: `/p/${pid}/c/${card.id}` };
      }
      return { to: scan ? `/p/${pid}/scan/${scan.id}` : `/p/${pid}` };
    },
    onSuccess: ({ to }) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      navigate(to);
    },
    onError: (e) => { setProgress(null); toast.error(e.message); },
  });

  const scale = Math.min(360 / dim.width, 300 / dim.height);

  return (
    <div className="mx-auto max-w-[1180px] pb-20">
      <PageHeader title="New Project" sub="A project is a campaign: one link or many pages becomes one project with many cards." />
      <div className="grid grid-cols-[1fr_400px] gap-8 px-8">
        <div className="flex flex-col gap-7">
          <Step n={1} title="Project name">
            <Input autoFocus placeholder="Ireland Company Setup" value={name} onChange={(e) => { nameTouched.current = true; setName(e.target.value); }} />
          </Step>

          <Step n={2} title="Input">
            <div className="grid grid-cols-3 gap-2">
              {INPUTS.map((o) => (
                <button key={o.value} onClick={() => setInput(o.value)} className={cx('press flex h-[68px] flex-col items-start justify-center gap-1 rounded-lg border px-3 text-left', input === o.value ? 'border-ink bg-panel shadow-[0_0_0_1px_#111]' : 'border-line bg-panel hover:border-line-strong')}>
                  <span className="flex items-center gap-2 text-[13px] font-medium">{o.icon}{o.label}</span>
                  <span className="text-[11.5px] leading-tight text-muted">{o.hint}</span>
                </button>
              ))}
            </div>
            <div className="mt-3">
              {input === 'url' ? <Input placeholder="https://arnifi.com/services/legal-services" value={url} onChange={(e) => setUrl(e.target.value)} /> : null}
              {input === 'urls' ? <Textarea rows={5} placeholder={'https://arnifi.com/product-details/…\nhttps://arnifi.com/services/…'} value={urls} onChange={(e) => setUrls(e.target.value)} /> : null}
              {input === 'upload' ? (
                <DropZone files={files} onFiles={setFiles} />
              ) : null}
              {input === 'screenshot' ? (
                <div className="flex min-h-[120px] items-center justify-center rounded-lg border border-dashed border-line-strong bg-panel p-4 text-center text-[13px] text-muted">
                  {shot ? <img src={URL.createObjectURL(shot)} alt="" className="max-h-48 rounded-md" /> : <span>Press <b className="text-ink">⌘V</b> to paste a screenshot. It becomes a card you can attach a webpage to later.</span>}
                </div>
              ) : null}
              {input === 'import' ? <FolderPicker folder={folder} onFolder={setFolder} /> : null}
            </div>
          </Step>

          <Step n={3} title="Creative recipe">
            <div className="grid grid-cols-3 gap-2">
              {(boot?.recipes ?? []).map((r) => (
                <button key={r.id} onClick={() => setRecipeId(r.id)} className={cx('press rounded-lg border px-3 py-2.5 text-left', recipeId === r.id ? 'border-ink shadow-[0_0_0_1px_#111]' : 'border-line hover:border-line-strong', 'bg-panel')}>
                  <div className="text-[13px] font-medium">{r.name}</div>
                  <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted">{r.description}</div>
                </button>
              ))}
            </div>
          </Step>

          <Step n={4} title="Dimensions">
            <div className="flex flex-wrap gap-2">
              {(boot?.dimensionPresets ?? []).map((p) => (
                <button key={p.label} onClick={() => setDim({ width: p.width, height: p.height, custom: false })}
                  className={cx('press h-8 rounded-md border px-3 text-[13px] tabular-nums', !dim.custom && dim.width === p.width && dim.height === p.height ? 'border-ink bg-ink text-white' : 'border-line bg-panel hover:border-line-strong')}>
                  {p.label}
                </button>
              ))}
              <button onClick={() => setDim({ ...dim, custom: true })} className={cx('press h-8 rounded-md border px-3 text-[13px]', dim.custom ? 'border-ink bg-ink text-white' : 'border-line bg-panel hover:border-line-strong')}>Custom</button>
            </div>
            {dim.custom ? (
              <div className="mt-3 flex items-center gap-2">
                <Field label="Width" className="w-28"><Input type="number" value={dim.width} onChange={(e) => setDim({ ...dim, width: Math.max(16, Math.min(8192, Number(e.target.value) || 16)) })} /></Field>
                <span className="mt-6 text-muted">×</span>
                <Field label="Height" className="w-28"><Input type="number" value={dim.height} onChange={(e) => setDim({ ...dim, height: Math.max(16, Math.min(8192, Number(e.target.value) || 16)) })} /></Field>
              </div>
            ) : null}
          </Step>

          <Step n={5} title="Layers" sub="Any combination. None of them is mandatory, and every card can change it later.">
            <div className="flex flex-wrap gap-2">
              {LAYERS.map((l) => (
                <label key={l.key} className="flex h-9 items-center gap-2.5 rounded-lg border border-line bg-panel px-3 text-[13px]">
                  <Switch checked={layers[l.key]} onCheckedChange={(v) => setLayers({ ...layers, [l.key]: v })} label={l.label} />
                  {l.label}
                </label>
              ))}
            </div>
          </Step>

          <Step n={6} title="AI provider">
            <div className="grid grid-cols-4 gap-2">
              {PROVIDERS.map((p) => (
                <button key={p.value} onClick={() => setProvider(p.value)} className={cx('press rounded-lg border bg-panel px-3 py-2.5 text-left', provider === p.value ? 'border-ink shadow-[0_0_0_1px_#111]' : 'border-line hover:border-line-strong')}>
                  <div className="text-[13px] font-medium">{p.label}</div>
                  <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{p.hint}</div>
                </button>
              ))}
            </div>
          </Step>
        </div>

        <aside className="sticky top-6 h-fit">
          <div className="rounded-xl border border-line bg-panel p-4">
            <div className="mb-3 flex items-center gap-2 text-[12px] font-medium text-muted"><Layers className="size-3.5" /> Preview · {dim.width} × {dim.height}</div>
            <div className="flex items-center justify-center rounded-lg bg-canvas p-3" style={{ height: 320 }}>
              <div style={{ width: dim.width * scale, height: dim.height * scale }} className="overflow-hidden rounded-[3px] shadow-[var(--shadow-card)]">
                <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0' }}>
                  <CardScene design={preview} resolveSrc={builtinUrl} />
                </div>
              </div>
            </div>
            <div className="mt-3 text-[12px] text-muted">{recipe?.description}</div>
            <Button variant="primary" className="mt-4 w-full" disabled={!ready} loading={create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? progress ?? 'Creating…' : input === 'url' || input === 'urls' ? 'Create project and scan' : 'Create project'}
            </Button>
            {input === 'url' || input === 'urls' ? <div className="mt-2 text-center text-[11.5px] text-faint">Nothing is generated before you see what was found.</div> : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Step({ n, title, sub, children }: { n: number; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-baseline gap-2.5">
        <span className="flex size-5 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white tabular-nums">{n}</span>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {sub ? <span className="text-[12px] text-muted">{sub}</span> : null}
      </div>
      {children}
    </section>
  );
}

function DropZone({ files, onFiles }: { files: File[]; onFiles: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const accept = (list: FileList | null) => onFiles([...files, ...[...(list ?? [])].filter((f) => /image\/(png|jpe?g|webp)/.test(f.type))]);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); accept(e.dataTransfer.files); }}
      onClick={() => ref.current?.click()}
      className={cx('flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-panel p-4 text-[13px] text-muted', over ? 'border-ink' : 'border-line-strong')}
    >
      <input ref={ref} type="file" multiple accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => accept(e.target.files)} />
      {files.length ? (
        <div className="flex flex-wrap justify-center gap-2">
          {files.slice(0, 12).map((f, i) => <img key={i} src={URL.createObjectURL(f)} alt="" className="h-14 rounded object-cover" />)}
          {files.length > 12 ? <span className="self-center">+{files.length - 12}</span> : null}
        </div>
      ) : <span>Drop images here, or click to choose. PNG, JPG or WebP up to 25 MB.</span>}
    </div>
  );
}

function FolderPicker({ folder, onFolder }: { folder: LegacyFolder | null; onFolder: (f: LegacyFolder | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-panel p-4 text-[13px]">
      <input ref={ref} type="file" className="hidden" {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} multiple
        onChange={async (e) => {
          setError(null);
          try { onFolder(await readLegacyFolder([...(e.target.files ?? [])])); } catch (err) { setError((err as Error).message); onFolder(null); }
        }} />
      <div className="flex items-center justify-between gap-3">
        <div className="text-muted">
          {folder ? <span className="text-ink">{folder.name}: {folder.records.length} cards found{folder.withFinal ? `, ${folder.withFinal} with their shipped card` : ''}.</span>
            : 'Choose a folder from arnifi-studio/output (or one of its country sub-folders).'}
          {error ? <div className="mt-1 text-err">{error}</div> : null}
        </div>
        <Button size="sm" onClick={() => ref.current?.click()}>Choose folder</Button>
      </div>
    </div>
  );
}
