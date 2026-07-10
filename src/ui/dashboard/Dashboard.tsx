import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { Track } from '@foundation/types';
import { CreateTrackModal } from './CreateTrackModal';
import { ActivityDot } from '@ui/shared/ActivityDot';

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
  const [showHidden, setShowHidden] = useState(false);

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

  // Optimistically toggle this track's hidden pref for the current profile, then persist.
  const toggleHidden = useCallback((trackId: string, hidden: boolean) => {
    setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, hidden } : t)));
    fetch(`/api/tracks/${trackId}/prefs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden }),
    }).catch(() => {});
  }, []);

  const visible = useMemo(() => {
    let list = showSystem ? tracks : tracks.filter((t) => t.label !== 'system');
    if (!showHidden) list = list.filter((t) => !t.hidden);
    return sortTracks(list, sort);
  }, [tracks, showSystem, showHidden, sort]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <header className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-xl font-semibold">Tracks</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={() => setShowHidden((v) => !v)}
              className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500/30 focus:ring-offset-0"
            />
            Hidden
          </label>
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
                sort === 'activity' ? 'bg-gray-800 text-gray-200' : 'hover:text-gray-300'
              }`}
            >
              Recent
            </button>
            <button
              onClick={() => changeSort('alphabetical')}
              className={`px-2 py-1 rounded transition-colors ${
                sort === 'alphabetical' ? 'bg-gray-800 text-gray-200' : 'hover:text-gray-300'
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
      ) : visible.length === 0 ? (
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
          {visible.map((track) => (
            <TrackCard
              key={track.id}
              track={track}
              activity={activity[track.id]}
              onToggleHidden={() => toggleHidden(track.id, !track.hidden)}
            />
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

interface TrackCardProps {
  track: Track;
  activity: TrackActivity | undefined;
  onToggleHidden: () => void;
}

function TrackCard({ track, activity, onToggleHidden }: TrackCardProps) {
  return (
    <div className="relative">
      <Link
        to={`/tracks/${track.id}`}
        className={`block p-5 bg-gray-900 border rounded-lg hover:border-gray-600 transition-colors ${
          track.hidden ? 'border-gray-800 opacity-60' : 'border-gray-800'
        }`}
      >
        <h2 className="text-lg font-semibold mb-1 pr-8">{track.name}</h2>
        {track.description && (
          <p className="text-sm text-gray-400 mb-3 line-clamp-2">{track.description}</p>
        )}
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>{track.status}</span>
          <TrackActivityBadges activity={activity} />
        </div>
      </Link>

      {/* Hide toggle — sibling of the Link so clicks don't navigate. */}
      <button
        onClick={onToggleHidden}
        title={track.hidden ? 'Unhide track' : 'Hide track'}
        aria-label={track.hidden ? 'Unhide track' : 'Hide track'}
        className="absolute top-3 right-3 p-1 text-gray-600 hover:text-gray-300 transition-colors"
      >
        <HideIcon hidden={track.hidden} />
      </button>
    </div>
  );
}

function HideIcon({ hidden }: { hidden?: boolean }) {
  if (hidden) {
    // eye-slash: currently hidden, click to reveal
    return (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
      </svg>
    );
  }
  // eye: currently visible, click to hide
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function TrackActivityBadges({ activity }: { activity: TrackActivity | undefined }) {
  if (!activity || activity.total === 0) return null;

  return (
    <span className="flex items-center gap-1.5 ml-auto">
      {activity.needsInput > 0 && (
        <span className="flex items-center gap-0.5 text-red-400" title={`${activity.needsInput} waiting for input`}>
          <ActivityDot activityStatus="needs-input" className="inline-block" />
          {activity.needsInput}
        </span>
      )}
      {activity.working > 0 && (
        <span className="flex items-center gap-0.5 text-green-400" title={`${activity.working} working`}>
          <ActivityDot activityStatus="working" className="inline-block" />
          {activity.working}
        </span>
      )}
      {activity.idle > 0 && (
        <span className="flex items-center gap-0.5 text-yellow-500" title={`${activity.idle} idle`}>
          <ActivityDot activityStatus="idle" className="inline-block" />
          {activity.idle}
        </span>
      )}
    </span>
  );
}
