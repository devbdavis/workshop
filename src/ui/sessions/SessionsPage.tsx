import { useEffect, useState, useCallback } from 'react';
import type { Session, Track } from '@foundation/types';
import { TerminalModal } from '../track-view/TerminalModal';

const STATE_STYLES: Record<string, string> = {
  active: 'bg-green-900/60 text-green-300',
  detached: 'bg-yellow-900/60 text-yellow-300',
  dead: 'bg-red-900/60 text-red-300',
};

export function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [attachedSession, setAttachedSession] = useState<Session | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'background'>('all');

  const trackNames = Object.fromEntries(tracks.map((t) => [t.id, t.name]));

  const loadData = useCallback(async () => {
    try {
      const [sessionsRes, tracksRes] = await Promise.all([
        fetch('/api/sessions'),
        fetch('/api/tracks'),
      ]);
      if (sessionsRes.ok) setSessions(await sessionsRes.json());
      if (tracksRes.ok) setTracks(await tracksRes.json());
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // WebSocket for real-time updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data);
        if (event.type?.startsWith('session:')) {
          loadData();
        }
      } catch {
        // ignore
      }
    };
    return () => ws.close();
  }, [loadData]);

  const filtered = sessions.filter((s) => {
    if (filter === 'active') return s.state === 'active' && !s.background;
    if (filter === 'background') return s.background;
    return true;
  });

  const activeSessions = filtered.filter((s) => s.state === 'active');
  const inactiveSessions = filtered.filter((s) => s.state !== 'active');

  if (loading) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-4 px-6 py-2 border-b border-gray-800 shrink-0">
        <h1 className="text-lg font-semibold">Sessions</h1>
        <span className="text-xs text-gray-500">
          {sessions.filter((s) => s.state === 'active').length} active
        </span>
        <div className="ml-auto flex items-center gap-2">
          <FilterButton label="All" value="all" current={filter} onChange={setFilter} />
          <FilterButton label="Foreground" value="active" current={filter} onChange={setFilter} />
          <FilterButton label="Background" value="background" current={filter} onChange={setFilter} />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            No sessions found.
          </div>
        ) : (
          <div className="space-y-6 max-w-5xl">
            {activeSessions.length > 0 && (
              <SessionGroup
                label="Active"
                sessions={activeSessions}
                trackNames={trackNames}
                onAttach={setAttachedSession}
              />
            )}
            {inactiveSessions.length > 0 && (
              <SessionGroup
                label="Inactive"
                sessions={inactiveSessions}
                trackNames={trackNames}
                onAttach={setAttachedSession}
              />
            )}
          </div>
        )}
      </div>

      {attachedSession && (
        <TerminalModal
          trackId={attachedSession.trackId}
          sessionId={attachedSession.id}
          title={attachedSession.name || `session:${attachedSession.id.slice(0, 8)}`}
          onClose={() => setAttachedSession(null)}
        />
      )}
    </div>
  );
}

function SessionGroup({
  label,
  sessions,
  trackNames,
  onAttach,
}: {
  label: string;
  sessions: Session[];
  trackNames: Record<string, string>;
  onAttach: (session: Session) => void;
}) {
  return (
    <div>
      <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
        {label} ({sessions.length})
      </h2>
      <div className="space-y-1">
        {sessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            trackName={trackNames[session.trackId] || session.trackId.slice(0, 8)}
            onAttach={() => onAttach(session)}
          />
        ))}
      </div>
    </div>
  );
}

function SessionRow({
  session,
  trackName,
  onAttach,
}: {
  session: Session;
  trackName: string;
  onAttach: () => void;
}) {
  const displayName = session.name || `session:${session.id.slice(0, 8)}`;
  const canAttach = session.state === 'active';

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-700 transition-colors group">
      {/* State indicator */}
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${
          session.activityStatus === 'needs-input'
            ? 'bg-red-500'
            : session.activityStatus === 'idle'
              ? 'bg-yellow-500'
              : session.activityStatus === 'working'
                ? 'bg-green-500'
                : session.state === 'active'
                  ? 'bg-green-500'
                  : session.state === 'detached'
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
        }`}
        title={
          session.activityStatus === 'needs-input'
            ? 'Needs input'
            : session.activityStatus === 'idle'
              ? 'Idle'
              : session.activityStatus === 'working'
                ? 'Working'
                : session.state
        }
      />

      {/* Name */}
      <span className="text-sm text-gray-200 font-mono min-w-0 truncate">
        {displayName}
      </span>

      {/* Track badge */}
      <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded shrink-0">
        {trackName}
      </span>

      {/* Background badge */}
      {session.background && (
        <span className="text-[10px] px-1.5 py-0.5 bg-emerald-900/50 text-emerald-400 rounded shrink-0">
          background
        </span>
      )}

      {/* State badge */}
      <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${STATE_STYLES[session.state] || ''}`}>
        {session.state}
      </span>

      {/* tmux info */}
      <span className="text-[10px] text-gray-600 font-mono shrink-0 hidden lg:inline">
        {session.tmuxSession}
      </span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Attach button */}
      {canAttach ? (
        <button
          onClick={onAttach}
          className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors opacity-60 group-hover:opacity-100"
        >
          Attach
        </button>
      ) : (
        <span className="text-xs text-gray-600 px-3 py-1">offline</span>
      )}
    </div>
  );
}

function FilterButton({
  label,
  value,
  current,
  onChange,
}: {
  label: string;
  value: 'all' | 'active' | 'background';
  current: string;
  onChange: (v: 'all' | 'active' | 'background') => void;
}) {
  const isActive = value === current;
  return (
    <button
      onClick={() => onChange(value)}
      className={`px-2.5 py-1 text-xs rounded transition-colors ${
        isActive
          ? 'bg-gray-800 text-gray-200'
          : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'
      }`}
    >
      {label}
    </button>
  );
}
