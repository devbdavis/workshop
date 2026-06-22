import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { Track, UserId } from '@foundation/types';
import { CreateTrackModal } from './CreateTrackModal';
import { useProfile } from '../hooks/useProfile';

interface TrackActivity {
  working: number;
  idle: number;
  needsInput: number;
  total: number;
}

type SortOption = 'activity' | 'alphabetical';
type OwnerFilter = 'all' | 'mine' | 'theirs';

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
  // Float favorites to the top, preserving sort order within each group.
  return [...sorted.filter((t) => t.favorite), ...sorted.filter((t) => !t.favorite)];
}

export function Dashboard() {
  const { user, users } = useProfile();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [activity, setActivity] = useState<Record<string, TrackActivity>>({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [sort, setSort] = useState<SortOption>(loadSavedSort);
  const [showSystem, setShowSystem] = useState(loadShowSystem);
  const [showHidden, setShowHidden] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all');

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

  // Optimistically update one track's per-user pref, then persist.
  const setPref = useCallback((trackId: string, pref: { favorite?: boolean; hidden?: boolean }) => {
    setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, ...pref } : t)));
    fetch(`/api/tracks/${trackId}/prefs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pref),
    }).catch(() => {});
  }, []);

  const setOwner = useCallback((trackId: string, ownerUserId: string | null) => {
    setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, ownerUserId: (ownerUserId as UserId) ?? undefined } : t)));
    fetch(`/api/tracks/${trackId}/owner`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: ownerUserId }),
    }).catch(() => {});
  }, []);

  const visible = useMemo(() => {
    let list = showSystem ? tracks : tracks.filter((t) => t.label !== 'system');
    if (!showHidden) list = list.filter((t) => !t.hidden);
    if (ownerFilter === 'mine') list = list.filter((t) => t.ownerUserId && t.ownerUserId === user?.id);
    else if (ownerFilter === 'theirs') list = list.filter((t) => t.ownerUserId && t.ownerUserId !== user?.id);
    return sortTracks(list, sort);
  }, [tracks, showSystem, showHidden, ownerFilter, user?.id, sort]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <header className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-xl font-semibold">Tracks</h1>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Owner filter (Mine / Theirs / All) */}
          <div className="flex items-center gap-1 text-xs text-gray-500">
            {(['all', 'mine', 'theirs'] as OwnerFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setOwnerFilter(f)}
                className={`px-2 py-1 rounded transition-colors capitalize ${
                  ownerFilter === f ? 'bg-gray-800 text-gray-200' : 'hover:text-gray-300'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="w-px h-4 bg-gray-700" />
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
              owners={users}
              onToggleFavorite={() => setPref(track.id, { favorite: !track.favorite })}
              onToggleHidden={() => setPref(track.id, { hidden: !track.hidden })}
              onSetOwner={(uid) => setOwner(track.id, uid)}
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
  owners: { id: string; name: string; color?: string }[];
  onToggleFavorite: () => void;
  onToggleHidden: () => void;
  onSetOwner: (userId: string | null) => void;
}

function TrackCard({ track, activity, owners, onToggleFavorite, onToggleHidden, onSetOwner }: TrackCardProps) {
  const owner = owners.find((o) => o.id === track.ownerUserId);
  return (
    <div className="relative">
      <Link
        to={`/tracks/${track.id}`}
        className={`block p-5 bg-gray-900 border rounded-lg hover:border-gray-600 transition-colors ${
          track.hidden ? 'border-gray-800 opacity-60' : 'border-gray-800'
        }`}
      >
        <h2 className="text-lg font-semibold mb-1 pr-16">{track.name}</h2>
        {track.description && (
          <p className="text-sm text-gray-400 mb-3 line-clamp-2">{track.description}</p>
        )}
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span>{track.status}</span>
          {owner && (
            <span className="flex items-center gap-1" title={`Owner: ${owner.name}`}>
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{ backgroundColor: owner.color || '#3b82f6' }}
              />
              {owner.name}
            </span>
          )}
          <TrackActivityBadges activity={activity} />
        </div>
      </Link>

      {/* Per-user action toolbar — sibling of the Link so clicks don't navigate. */}
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <select
          value={track.ownerUserId ?? ''}
          onChange={(e) => onSetOwner(e.target.value || null)}
          title="Assign owner"
          className="text-[10px] bg-gray-800 border border-gray-700 rounded text-gray-400 max-w-[5rem] focus:outline-none"
        >
          <option value="">— owner —</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <button
          onClick={onToggleHidden}
          title={track.hidden ? 'Unhide' : 'Hide'}
          className="text-gray-600 hover:text-gray-300 p-0.5"
        >
          {track.hidden ? '🙈' : '👁'}
        </button>
        <button
          onClick={onToggleFavorite}
          title={track.favorite ? 'Unfavorite' : 'Favorite'}
          className={track.favorite ? 'text-yellow-400' : 'text-gray-600 hover:text-yellow-400'}
        >
          {track.favorite ? '★' : '☆'}
        </button>
      </div>
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
