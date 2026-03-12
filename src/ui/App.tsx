import { Routes, Route } from 'react-router-dom';
import { Dashboard } from './dashboard/Dashboard';
import { TrackView } from './track-view/TrackView';
import { Settings } from './settings/Settings';
import { KanbanBoard } from './kanban/KanbanBoard';
import { AgentsPage } from './agents/AgentsPage';
import { TopNav } from './TopNav';

export function App() {
  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
      <TopNav />
      <div className="flex-1 min-h-0">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/tracks/:trackId" element={<TrackView />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/kanban" element={<KanbanBoard />} />
          <Route path="/agents" element={<AgentsPage />} />
        </Routes>
      </div>
    </div>
  );
}
