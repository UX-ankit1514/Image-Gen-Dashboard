/** Home / Projects (PRD §11). */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, Copy, Download, FolderOpen, FolderSearch, ImageUp, Link2, MoreHorizontal, PackageOpen, Pencil, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { ago, plural } from '../lib/format';
import { useProjects } from '../lib/queries';
import type { ProjectX } from '../lib/types';
import { PageHeader } from '../shell/AppShell';
import { Badge, Button, Dialog, Empty, IconButton, Input, Menu, MenuItem, MenuSeparator, Segmented, cx } from '../ui';
import { ExportDialog } from '../components/ExportDialog';

const PROVIDER: Record<string, string> = { chatgpt: 'ChatGPT', claude: 'Claude', auto: 'Automatic', none: 'No AI' };

export function ProjectsPage() {
  const [view, setView] = useState<'active' | 'archived'>('active');
  const { data, isLoading, error } = useProjects(view === 'archived');
  const navigate = useNavigate();
  const [paste, setPaste] = useState(false);
  const [url, setUrl] = useState('');
  const projects = (data ?? []).filter((p) => (view === 'archived' ? p.status === 'archived' : p.status !== 'archived'));

  return (
    <div className="mx-auto max-w-[1280px] pb-16">
      <PageHeader title="Creative Studio" sub="Every campaign, card, version and approval, right where you left it."
        actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/new')}>New Project</Button>} />
      <div className="grid grid-cols-3 gap-3 px-8">
        <QuickAction icon={<Link2 className="size-4" />} title="Paste URL" sub="An Arnifi page or section" onClick={() => setPaste(true)} />
        <QuickAction icon={<ImageUp className="size-4" />} title="Upload Image" sub="Your own image or a screenshot" onClick={() => navigate('/new?input=upload')} />
        <QuickAction icon={<PackageOpen className="size-4" />} title="Import Existing Project" sub="A folder from the previous card runs" onClick={() => navigate('/new?input=import')} />
      </div>

      <div className="mt-8 flex items-center justify-between px-8">
        <h2 className="text-[16px] font-semibold">Projects</h2>
        <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }]} />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 px-8 pt-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-[268px] rounded-xl" />)}
        </div>
      ) : error ? (
        <Empty icon={<FolderOpen className="size-8" strokeWidth={1.5} />} title="Couldn't load projects">{error.message}</Empty>
      ) : projects.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 px-8 pt-4">
          {projects.map((p) => <ProjectCard key={p.id} p={p} />)}
        </div>
      ) : (
        <Empty icon={<FolderOpen className="size-8" strokeWidth={1.5} />} title={view === 'archived' ? 'No archived projects' : 'No projects yet'}
          action={view === 'active' ? <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/new')}>New Project</Button> : null}>
          {view === 'active' ? 'Paste an Arnifi link, upload an image, or start from a blank canvas.' : null}
        </Empty>
      )}

      <Dialog open={paste} onOpenChange={setPaste} title="Paste a URL" description="A product page, a listing, or a whole service section."
        footer={<><Button onClick={() => setPaste(false)}>Cancel</Button><Button variant="primary" disabled={!url.trim()} onClick={() => navigate(`/new?input=url&url=${encodeURIComponent(url.trim())}`)}>Continue</Button></>}>
        <Input autoFocus placeholder="https://arnifi.com/services/…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url.trim() && navigate(`/new?input=url&url=${encodeURIComponent(url.trim())}`)} />
      </Dialog>
    </div>
  );
}

function QuickAction({ icon, title, sub, onClick }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="press flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3.5 text-left hover:border-line-strong">
      <span className="flex size-8 items-center justify-center rounded-lg bg-hover text-ink">{icon}</span>
      <span>
        <span className="block text-[13.5px] font-medium">{title}</span>
        <span className="block text-[12px] text-muted">{sub}</span>
      </span>
    </button>
  );
}

function ProjectCard({ p }: { p: ProjectX }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [rename, setRename] = useState(false);
  const [name, setName] = useState(p.name);
  const [exporting, setExporting] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['projects'] });
  const patch = useMutation({ mutationFn: (b: Record<string, unknown>) => api.patch(`/projects/${p.id}`, b), onSuccess: refresh, onError: (e) => toast.error(e.message) });
  const dup = useMutation({ mutationFn: () => api.post<{ id: string }>(`/projects/${p.id}/duplicate`, {}), onSuccess: (r) => { refresh(); toast.success('Project duplicated'); navigate(`/p/${r.id}`); }, onError: (e) => toast.error(e.message) });
  const s = p.stats;
  const covers = p.coverUrls ?? [];

  return (
    <div className="group relative overflow-hidden rounded-xl border border-line bg-panel transition-[border-color] hover:border-line-strong">
      <Link to={`/p/${p.id}`} className="block">
        <div className={cx('grid aspect-[1.6] gap-px bg-line', covers.length > 1 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-1')}>
          {covers.length ? covers.slice(0, 4).map((u, i) => <img key={i} src={u} alt="" loading="lazy" className="size-full object-cover" />)
            : <div className="flex items-center justify-center bg-[#f1f1f1] text-[12px] text-faint">No cards yet</div>}
        </div>
        <div className="px-4 pt-3 pb-3.5">
          <div className="truncate text-[14.5px] font-medium">{p.name}</div>
          <div className="mt-0.5 text-[12px] text-muted">{plural(s.total, 'card')} · {p.width} × {p.height} · {PROVIDER[p.provider] ?? 'No AI'}</div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {s.approved ? <Badge tone="ok">{s.approved} Approved</Badge> : null}
            {s.review ? <Badge tone="info">{s.review} Review</Badge> : null}
            {s.needsImage ? <Badge tone="warn">{s.needsImage} Need Image</Badge> : null}
            {s.needsCopy ? <Badge tone="warn">{s.needsCopy} Copy Fix</Badge> : null}
            {s.errors ? <Badge tone="err">{s.errors} Errors</Badge> : null}
            {p.exportStatus !== 'none' ? <Badge>{p.exportStatus === 'exported' ? 'Exported' : 'Partly exported'}</Badge> : null}
          </div>
          <div className="mt-2.5 text-[11.5px] text-faint">Updated {ago(p.lastEditedAt)}</div>
        </div>
      </Link>
      <div className="absolute top-2 right-2">
        <Menu trigger={<IconButton label="Project actions" className="bg-white/90 shadow-sm backdrop-blur"><MoreHorizontal className="size-4" /></IconButton>}>
          <MenuItem icon={<FolderOpen className="size-3.5" />} onSelect={() => navigate(`/p/${p.id}`)}>Open</MenuItem>
          <MenuItem icon={<Copy className="size-3.5" />} onSelect={() => dup.mutate()}>Duplicate</MenuItem>
          <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => setRename(true)}>Rename</MenuItem>
          <MenuItem icon={<Download className="size-3.5" />} onSelect={() => setExporting(true)}>Export</MenuItem>
          <MenuItem icon={<FolderSearch className="size-3.5" />} onSelect={() => navigate(`/assets?project=${p.id}`)}>Reveal assets</MenuItem>
          <MenuSeparator />
          {p.status === 'archived'
            ? <MenuItem icon={<ArchiveRestore className="size-3.5" />} onSelect={() => patch.mutate({ status: 'active' })}>Restore</MenuItem>
            : <MenuItem icon={<Archive className="size-3.5" />} onSelect={() => patch.mutate({ status: 'archived' })}>Archive</MenuItem>}
        </Menu>
      </div>
      <Dialog open={rename} onOpenChange={setRename} title="Rename project"
        footer={<><Button onClick={() => setRename(false)}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={() => { patch.mutate({ name: name.trim() }); setRename(false); }}>Save</Button></>}>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </Dialog>
      {exporting ? <ExportDialog open={exporting} onOpenChange={setExporting} projectId={p.id} namingTemplate={p.namingTemplate} /> : null}
    </div>
  );
}
