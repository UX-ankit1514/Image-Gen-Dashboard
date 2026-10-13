/** Home: your projects, nothing else. */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, Copy, Download, FolderOpen, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { ago, plural } from '../lib/format';
import { useDownload } from '../lib/download';
import { useProjects } from '../lib/queries';
import type { ProjectX } from '../lib/types';
import { PageHeader } from '../shell/AppShell';
import { Button, Dialog, Empty, IconButton, Input, Menu, MenuItem, MenuSeparator, Segmented, cx } from '../ui';

export function ProjectsPage() {
  const [view, setView] = useState<'active' | 'archived'>('active');
  const { data, isLoading, error } = useProjects(view === 'archived');
  const navigate = useNavigate();
  const projects = (data ?? []).filter((p) => (view === 'archived' ? p.status === 'archived' : p.status !== 'archived'));

  return (
    <div className="mx-auto max-w-[1180px] pb-20">
      <PageHeader title="Projects"
        actions={<>
          <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }]} />
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/new')}>New project</Button>
        </>} />

      {isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-5 px-8 pt-2">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton aspect-[1.35] rounded-2xl" />)}
        </div>
      ) : error ? (
        <Empty icon={<FolderOpen className="size-8" strokeWidth={1.5} />} title="Couldn't load projects">{error.message}</Empty>
      ) : projects.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-5 px-8 pt-2">
          {projects.map((p) => <ProjectCard key={p.id} p={p} />)}
        </div>
      ) : (
        <Empty icon={<FolderOpen className="size-8" strokeWidth={1.5} />} title={view === 'archived' ? 'No archived projects' : 'No projects yet'}
          action={view === 'active' ? <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/new')}>New project</Button> : null}>
          {view === 'active' ? 'Paste an Arnifi link, upload an image, or start from a blank canvas.' : null}
        </Empty>
      )}
    </div>
  );
}

function ProjectCard({ p }: { p: ProjectX }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { download } = useDownload();
  const [rename, setRename] = useState(false);
  const [name, setName] = useState(p.name);
  const refresh = () => qc.invalidateQueries({ queryKey: ['projects'] });
  const patch = useMutation({ mutationFn: (b: Record<string, unknown>) => api.patch(`/projects/${p.id}`, b), onSuccess: refresh, onError: (e) => toast.error(e.message) });
  const dup = useMutation({ mutationFn: () => api.post<{ id: string }>(`/projects/${p.id}/duplicate`, {}), onSuccess: (r) => { refresh(); toast.success('Project duplicated'); navigate(`/p/${r.id}`); }, onError: (e) => toast.error(e.message) });
  const total = p.stats.total;
  const covers = p.coverUrls ?? [];

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-line bg-panel transition-[box-shadow,border-color] duration-200 hover:border-line-strong hover:shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)]">
      <Link to={`/p/${p.id}`} className="block">
        <div className={cx('grid aspect-[1.6] gap-0.5 bg-panel', covers.length > 1 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-1')}>
          {covers.length ? covers.slice(0, 4).map((u, i) => <img key={i} src={u} alt="" loading="lazy" className="size-full object-cover" />)
            : <div className="flex items-center justify-center bg-[#f1f1f1] text-[12px] text-faint">No cards yet</div>}
        </div>
        <div className="px-4 pt-3.5 pb-4">
          <div className="truncate text-[15px] font-medium tracking-tight">{p.name}</div>
          <div className="mt-0.5 text-[12.5px] text-muted">{plural(total, 'card')} · {ago(p.lastEditedAt)}</div>
        </div>
      </Link>
      <div className="absolute top-2.5 right-2.5">
        <Menu trigger={<IconButton label="Project actions" className="bg-white/90 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"><MoreHorizontal className="size-4" /></IconButton>}>
          <MenuItem icon={<FolderOpen className="size-3.5" />} onSelect={() => navigate(`/p/${p.id}`)}>Open</MenuItem>
          <MenuItem icon={<Download className="size-3.5" />} disabled={!total} onSelect={() => void download(p.id, 'all', total)}>Download all</MenuItem>
          <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => setRename(true)}>Rename</MenuItem>
          <MenuItem icon={<Copy className="size-3.5" />} onSelect={() => dup.mutate()}>Duplicate</MenuItem>
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
    </div>
  );
}
