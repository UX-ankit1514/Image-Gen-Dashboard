import { useQuery } from '@tanstack/react-query';
import type { Design, Scan } from '@acs/types';
import { api } from './api';
import type { AssetX, Bootstrap, CardX, ExportX, JobsView, ProjectX, ScanView } from './types';

export const useBootstrap = () => useQuery({ queryKey: ['bootstrap'], queryFn: () => api.get<Bootstrap>('/bootstrap'), staleTime: 5 * 60_000 });
export const useProjects = (archived = false) => useQuery({ queryKey: ['projects', archived], queryFn: () => api.get<ProjectX[]>(`/projects${archived ? '?archived=1' : ''}`) });
export const useProject = (pid: string) => useQuery({ queryKey: ['project', pid], queryFn: () => api.get<{ project: ProjectX; base: Design; recipe: { id: string; name: string } | null }>(`/projects/${pid}`) });

/** Cards poll while something is rendering, so thumbnails appear without a refresh. */
export const useCards = (pid: string, live = false) =>
  useQuery({ queryKey: ['cards', pid], queryFn: () => api.get<CardX[]>(`/projects/${pid}/cards`), refetchInterval: live ? 2000 : false });

export const useJobs = (pid: string) =>
  useQuery({
    queryKey: ['jobs', pid],
    queryFn: () => api.get<JobsView>(`/projects/${pid}/jobs`),
    refetchInterval: (q) => (q.state.data?.jobs.some((j) => ['queued', 'preparing', 'running'].includes(j.status)) ? 1500 : 10_000),
  });

export const useScans = (pid: string) => useQuery({ queryKey: ['scans', pid], queryFn: () => api.get<Scan[]>(`/projects/${pid}/scans`) });

export const useScan = (sid: string | null | undefined) =>
  useQuery({
    queryKey: ['scan', sid],
    enabled: !!sid,
    queryFn: () => api.get<ScanView>(`/scans/${sid}`),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return 1500;
      const scanning = !['done', 'failed'].includes(d.scan.status);
      const ingesting = d.ingest && d.ingest.completed + d.ingest.failed < d.ingest.total;
      return scanning || ingesting ? 1500 : false;
    },
  });

export const useProjectAssets = (pid: string | null) =>
  useQuery({ queryKey: ['assets', pid ?? 'global'], queryFn: () => api.get<AssetX[]>(pid ? `/projects/${pid}/assets` : '/assets'),
    refetchInterval: (q) => (q.state.data?.some((a) => a.status === 'pending') ? 2000 : false) });

export const useExports = (pid?: string) =>
  useQuery({ queryKey: ['exports', pid ?? 'all'], queryFn: () => api.get<ExportX[]>(`/exports${pid ? `?projectId=${pid}` : ''}`),
    refetchInterval: (q) => (q.state.data?.some((e) => ['queued', 'running'].includes(e.status)) ? 2000 : false) });
