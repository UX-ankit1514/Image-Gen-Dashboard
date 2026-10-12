import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import './styles.css';
import { queryClient } from './lib/api';
import { AppShell } from './shell/AppShell';
import { TipProvider } from './ui';
import { ProjectsPage } from './pages/Projects';
import { NewProjectPage } from './pages/NewProject';
import { WorkspacePage } from './pages/Workspace';
import { ScanPage } from './pages/Scan';
import { EditorPage } from './editor/EditorPage';
import { ReviewPage } from './pages/Review';
import { AssetsPage } from './pages/Assets';
import { TemplatesPage } from './pages/Templates';
import { ConnectionsPage } from './pages/Connections';
import { ExportsPage } from './pages/Exports';
import { SettingsPage } from './pages/Settings';
import { NotFound } from './pages/NotFound';

const router = createBrowserRouter([
  { path: '/p/:pid/c/:cid', element: <EditorPage /> },
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <ProjectsPage /> },
      { path: '/new', element: <NewProjectPage /> },
      { path: '/p/:pid', element: <WorkspacePage /> },
      { path: '/p/:pid/scan/:sid', element: <ScanPage /> },
      { path: '/review', element: <ReviewPage /> },
      { path: '/assets', element: <AssetsPage /> },
      { path: '/templates', element: <TemplatesPage /> },
      { path: '/connections', element: <ConnectionsPage /> },
      { path: '/exports', element: <ExportsPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TipProvider>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" toastOptions={{ style: { fontFamily: 'Inter, sans-serif', fontSize: 13, borderRadius: 10 } }} />
      </TipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
