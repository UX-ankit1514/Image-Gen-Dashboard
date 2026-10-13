import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
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
import { ConnectionsPage } from './pages/Connections';
import { SettingsPage } from './pages/Settings';
import { NotFound } from './pages/NotFound';
import { GenerateReviewPage, GenerateStartPage } from './pages/GenerateReview';
import { ExportPage } from './pages/ExportPage';

const router = createBrowserRouter([
  { path: '/p/:pid/c/:cid', element: <EditorPage /> },
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <ProjectsPage /> },
      { path: '/new', element: <NewProjectPage /> },
      { path: '/p/:pid', element: <WorkspacePage /> },
      { path: '/p/:pid/scan/:sid', element: <ScanPage /> },
      { path: '/p/:pid/generate', element: <GenerateStartPage /> },
      { path: '/p/:pid/generate/:bid', element: <GenerateReviewPage /> },
      { path: '/p/:pid/export', element: <ExportPage /> },
      { path: '/connections', element: <ConnectionsPage /> },
      // retired pages: old links land on the projects
      ...['/review', '/assets', '/templates', '/exports'].map((path) => ({ path, element: <Navigate to="/" replace /> })),
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
