import { Routes, Route } from 'react-router-dom';
import { Dashboard } from './dashboard/Dashboard';
import { TrackView } from './track-view/TrackView';
import { Settings } from './settings/Settings';

export function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tracks/:trackId" element={<TrackView />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </div>
  );
}
