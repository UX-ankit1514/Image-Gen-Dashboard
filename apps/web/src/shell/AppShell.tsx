import { NavLink, Outlet } from 'react-router';
import { Download, FolderKanban, Images, Inbox, LayoutTemplate, Plus, Settings, Sparkles } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { cx } from '../ui';

const NAV = [
  { to: '/', label: 'Projects', icon: FolderKanban, end: true },
  { to: '/new', label: 'Create', icon: Plus },
  { to: '/review', label: 'Review', icon: Inbox },
  { to: '/assets', label: 'Assets', icon: Images },
  { to: '/templates', label: 'Templates', icon: LayoutTemplate },
  { to: '/connections', label: 'AI Connections', icon: Sparkles },
  { to: '/exports', label: 'Exports', icon: Download },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell() {
  const inbox = useQuery({ queryKey: ['inbox-count'], queryFn: () => api.get<unknown[]>('/inbox'), refetchInterval: 60_000, select: (d) => d.length });
  return (
    <div className="flex h-full">
      <aside className="flex w-[208px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex h-14 items-center gap-2 px-4">
          <div className="flex size-6 items-center justify-center rounded-md bg-ink">
            <svg viewBox="0 0 32 32" className="size-4"><path d="M16 5l3.4 7.6L27 16l-7.6 3.4L16 27l-3.4-7.6L5 16l7.6-3.4z" fill="#fff" /></svg>
          </div>
          <span className="text-[14px] font-semibold tracking-tight">Creative Studio</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2 py-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => cx('press flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px]', isActive ? 'bg-ink text-white' : 'text-ink hoverable')}
            >
              <Icon className="size-4" strokeWidth={1.75} />
              <span className="flex-1">{label}</span>
              {label === 'Review' && inbox.data ? <span className="rounded-full bg-[#ececec] px-1.5 text-[10.5px] text-muted tabular-nums">{inbox.data}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto px-4 py-3 text-[11px] text-faint">Arnifi · V1</div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto scroll-quiet">
        <Outlet />
      </main>
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-4 px-8 pt-7 pb-5">
      <div className="min-w-0">
        <h1 className="truncate text-[24px] font-semibold tracking-tight">{title}</h1>
        {sub ? <div className="mt-1 text-[13px] text-muted">{sub}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
