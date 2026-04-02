import { Routes, Route } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthGate } from './auth/AuthGate';
import { applyTheme, type ThemeId } from './hooks/useTheme';
import { Dashboard } from './dashboard/Dashboard';
import { TrackView } from './track-view/TrackView';
import { Settings } from './settings/Settings';
import { KanbanBoard } from './kanban/KanbanBoard';
import { ScheduledTasksPage } from './scheduled-tasks/ScheduledTasksPage';
import { WorkflowPage } from './workflow/WorkflowPage';
import { EpicDetail } from './workflow/EpicDetail';
import { DiscussionsPage } from './discussions/DiscussionsPage';
import { NotificationsPage } from './notifications/NotificationsPage';
import { TopNav } from './TopNav';

export function App() {
  // Apply persisted theme before first paint to avoid flash
  useEffect(() => {
    const stored = localStorage.getItem('workshop-theme') as ThemeId | null;
    if (stored) applyTheme(stored);
  }, []);

  return (
    <AuthGate>
      <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
        <TopNav />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/tracks/:trackId" element={<TrackView />} />
            <Route path="/discussions" element={<DiscussionsPage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/kanban" element={<KanbanBoard />} />
            <Route path="/scheduled-tasks" element={<ScheduledTasksPage />} />
            <Route path="/workflow" element={<WorkflowPage />} />
            <Route path="/workflow/:id" element={<EpicDetail />} />
            <Route path="/notifications" element={<NotificationsPage />} />
          </Routes>
        </div>
      </div>
    </AuthGate>
  );
}
