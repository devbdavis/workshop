import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { Track } from '@foundation/types';
import { CreateTrackModal } from './CreateTrackModal';

interface TrackActivity {
  working: number;
  idle: number;
  needsInput: number;
  total: number;
}

type SortOption = 'activity' | 'alphabetical';

const SORT_STORAGE_KEY = 'workshop:tracks-sort';
const SHOW_SYSTEM_STORAGE_KEY = 'workshop:show-system-tracks';

function loadShowSystem(): boolean {
  try {
    return localStorage.getItem(SHOW_SYSTEM_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function loadSavedSort(): SortOption {
  try {
    const saved = localStorage.getItem(SORT_STORAGE_KEY);
    if (saved === 'activity' || saved === 'alphabetical') return saved;
  } catch {
    // ignore
  }
  return 'activity';
}

function sortTracks(tracks: Track[], sort: SortOption): Track[] {
  const sorted = [...tracks];
  if (sort === 'alphabetical') {
    sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  } else {
    sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return sorted;
}

export function Dashboard() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [activity, setActivity] = useState<Record<string, TrackActivity>>({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [sort, setSort] = useState<SortOption>(loadSavedSort);
  const [showSystem, setShowSystem] = useState(loadShowSystem);

  function changeSort(next: SortOption) {
    setSort(next);
    try { localStorage.setItem(SORT_STORAGE_KEY, next); } catch { /* ignore */ }
  }

  function toggleShowSystem() {
    const next = !showSystem;
    setShowSystem(next);
    try { localStorage.setItem(SHOW_SYSTEM_STORAGE_KEY, String(next)); } catch { /* ignore */ }
  }

  const loadActivity = useCallback(async () => {
    try {
      const res = await fetch('/api/tracks/activity');
      if (res.ok) setActivity(await res.json());
    } catch {
      // non-fatal — activity badges just stay empty
    }
  }, []);

  useEffect(() => {
    loadTracks();
  }, []);

  useEffect(() => {
    loadActivity();

    // Refresh activity counts whenever any session state changes
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
    ws.onopen = () => { loadActivity(); };
    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data) as { type: string };
        if (event.type.startsWith('session:')) loadActivity();
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, [loadActivity]);

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

  const filtered = useMemo(
    () => showSystem ? tracks : tracks.filter((t) => t.label !== 'system'),
    [tracks, showSystem],
  );
  const sorted = useMemo(() => sortTracks(filtered, sort), [filtered, sort]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Tracks</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showSystem}
              onChange={toggleShowSystem}
              className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/30 focus:ring-offset-0"
            />
            System tracks
          </label>
          <div className="w-px h-4 bg-gray-700" />
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <span>Sort:</span>
            <button
              onClick={() => changeSort('activity')}
              className={`px-2 py-1 rounded transition-colors ${
                sort === 'activity'
                  ? 'bg-gray-800 text-gray-200'
                  : 'hover:text-gray-300'
              }`}
            >
              Recent
            </button>
            <button
              onClick={() => changeSort('alphabetical')}
              className={`px-2 py-1 rounded transition-colors ${
                sort === 'alphabetical'
                  ? 'bg-gray-800 text-gray-200'
                  : 'hover:text-gray-300'
              }`}
            >
              A–Z
            </button>
          </div>
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
      ) : sorted.length === 0 ? (
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
          {sorted.map((track) => (
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
                <TrackActivityBadges activity={activity[track.id]} />
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

function TrackActivityBadges({ activity }: { activity: TrackActivity | undefined }) {
  if (!activity || activity.total === 0) return null;

  return (
    <span className="flex items-center gap-1.5 ml-auto">
      {activity.needsInput > 0 && (
        <span className="flex items-center gap-0.5 text-red-400" title={`${activity.needsInput} waiting for input`}>
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
          {activity.needsInput}
        </span>
      )}
      {activity.working > 0 && (
        <span className="flex items-center gap-0.5 text-green-400" title={`${activity.working} working`}>
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
          {activity.working}
        </span>
      )}
      {activity.idle > 0 && (
        <span className="flex items-center gap-0.5 text-yellow-500" title={`${activity.idle} idle`}>
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" />
          {activity.idle}
        </span>
      )}
    </span>
  );
}
