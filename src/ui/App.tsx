import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { AuthGate } from './auth/AuthGate';
import { ProfilePicker } from './auth/ProfilePicker';
import { ProfileProvider, useProfile } from './hooks/useProfile';
import { applyTheme, type ThemeId } from './hooks/useTheme';
import { Dashboard } from './dashboard/Dashboard';
import { TrackView } from './track-view/TrackView';
import { SessionOverview } from './session-overview/SessionOverview';
import { Settings } from './settings/Settings';
import { KanbanBoard } from './kanban/KanbanBoard';
import { ScheduledTasksPage } from './scheduled-tasks/ScheduledTasksPage';
import { WorkflowPage } from './workflow/WorkflowPage';
import { EpicDetail } from './workflow/EpicDetail';
import { DiscussionsPage } from './discussions/DiscussionsPage';
import { NotificationsPage } from './notifications/NotificationsPage';
import { PrReviewsPage } from './pr-reviews/PrReviewsPage';
import { SessionAlertsProvider } from './notifications/SessionAlerts';
import { TopNav } from './TopNav';

/** Gates the app behind profile selection (identity, not security). */
function ProfileGate({ children }: { children: ReactNode }) {
  const { user, loading } = useProfile();
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-950">
        <p className="text-gray-500 text-sm">Loading profile…</p>
      </div>
    );
  }
  if (!user) return <ProfilePicker />;
  return <>{children}</>;
}

export function App() {
  // Apply persisted theme before first paint to avoid flash
  useEffect(() => {
    const stored = localStorage.getItem('workshop-theme') as ThemeId | null;
    if (stored) applyTheme(stored);
  }, []);

  return (
    <AuthGate>
      <ProfileProvider>
        <ProfileGate>
          <SessionAlertsProvider>
            <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
              <TopNav />
              <div className="flex-1 min-h-0 overflow-y-auto">
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/tracks/:trackId" element={<TrackView />} />
                  <Route path="/sessions" element={<SessionOverview />} />
                  <Route path="/discussions" element={<DiscussionsPage />} />
                  <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
                  <Route path="/settings/:tab" element={<Settings />} />
                  <Route path="/kanban" element={<KanbanBoard />} />
                  <Route path="/scheduled-tasks" element={<ScheduledTasksPage />} />
                  <Route path="/workflow" element={<WorkflowPage />} />
                  <Route path="/workflow/:id" element={<EpicDetail />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                  <Route path="/pr-reviews" element={<PrReviewsPage />} />
                </Routes>
              </div>
            </div>
          </SessionAlertsProvider>
        </ProfileGate>
      </ProfileProvider>
    </AuthGate>
  );
}
