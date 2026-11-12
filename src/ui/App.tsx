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
import { SessionHistoryPage } from './session-history/SessionHistoryPage';
import { TopNav } from './TopNav';
import { CommandPalette } from './command-palette/CommandPalette';
import { PermissionPrompt } from './permissions/PermissionPrompt';

/** Gates the app behind profile selection (identity, not security). */
function ProfileGate({ children }: { children: ReactNode }) {
  const { user, loading } = useProfile();
  if (loading) {
    return (
      <div className="h-app flex items-center justify-center bg-gray-950">
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

  // iOS ignores interactive-widget, so track the visual viewport to shrink the shell with the keyboard
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    // Ignore pinch-zoom: a zoomed visual viewport is smaller but the layout must not shrink or snap back
    const zoomed = (): boolean => vv.scale > 1.01;
    const onResize = (): void => {
      if (!zoomed()) document.documentElement.style.setProperty('--app-h', `${vv.height}px`);
    };
    // iOS scrolls the layout viewport when an input focuses; the shell never scrolls, so undo it
    const onScroll = (): void => {
      if (!zoomed()) window.scrollTo(0, 0);
    };
    onResize();
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onScroll);
    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <AuthGate>
      <ProfileProvider>
        <ProfileGate>
          <SessionAlertsProvider>
            <div className="h-app flex flex-col bg-gray-950 text-gray-100 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
              <TopNav />
              <CommandPalette />
              <PermissionPrompt />
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
                  <Route path="/history" element={<SessionHistoryPage />} />
                </Routes>
              </div>
            </div>
          </SessionAlertsProvider>
        </ProfileGate>
      </ProfileProvider>
    </AuthGate>
  );
}
