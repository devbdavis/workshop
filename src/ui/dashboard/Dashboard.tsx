import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Track } from '@foundation/types';
import { CreateTrackModal } from './CreateTrackModal';

export function Dashboard() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    loadTracks();
  }, []);

  async function loadTracks() {
    try {
      const res = await fetch('/api/tracks');
      const data = await res.json();
      setTracks(data);
    } catch (err) {
      console.error('Failed to load tracks:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <header className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Workshop</h1>
        <div className="flex gap-3">
          <Link
            to="/settings"
            className="px-4 py-2 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
          >
            Settings
          </Link>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
          >
            New Track
          </button>
        </div>
      </header>

      {loading ? (
        <div className="text-gray-400">Loading...</div>
      ) : tracks.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-400 mb-4">No project tracks yet.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
          >
            Create your first track
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tracks.map((track) => (
            <Link
              key={track.id}
              to={`/tracks/${track.id}`}
              className="block p-5 bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-600 transition-colors"
            >
              <h2 className="text-lg font-semibold mb-1">{track.name}</h2>
              {track.description && (
                <p className="text-sm text-gray-400 mb-3 line-clamp-2">{track.description}</p>
              )}
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span>{track.status}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateTrackModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            loadTracks();
          }}
        />
      )}
    </div>
  );
}
