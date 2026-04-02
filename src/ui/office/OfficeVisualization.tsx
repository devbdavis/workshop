import { useEffect, useState, useCallback, useRef } from 'react';
import type { Session, Track } from '@foundation/types';
import { TerminalModal } from '../track-view/TerminalModal';
import { OfficeDeskUnit } from './OfficeDeskUnit';
import { getActivityState } from './activity';

/** Enriched session shape from the API (base Session + runtime fields) */
type EnrichedSession = Session & { dying?: boolean };

export function OfficeVisualization() {
  const [sessions, setSessions] = useState<EnrichedSession[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [attachedSession, setAttachedSession] = useState<EnrichedSession | null>(null);
  const [filterTrackId, setFilterTrackId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trackNames = Object.fromEntries(tracks.map((t) => [t.id, t.name]));

  // Fetch tracks once on mount
  useEffect(() => {
    fetch('/api/tracks')
      .then((r) => (r.ok ? r.json() : []))
      .then(setTracks)
      .catch(() => {});
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) setSessions(await res.json());
    } catch {
      // quietly
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // WebSocket: reload sessions on session:* events, 500ms debounced
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);

    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data);
        if (event.type?.startsWith('session:')) {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(loadSessions, 500);
        }
      } catch {
        // ignore
      }
    };

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      ws.close();
    };
  }, [loadSessions]);

  // Filter out dead sessions unless they are in the dying phase
  const aliveSessions = sessions.filter(
    (s) => s.state !== 'dead' || s.dying,
  );

  // Collect only the tracks that have at least one visible session
  const tracksWithSessions = tracks.filter((t) =>
    aliveSessions.some((s) => s.trackId === t.id),
  );

  const visibleSessions = filterTrackId
    ? aliveSessions.filter((s) => s.trackId === filterTrackId)
    : aliveSessions;

  const activeCount = aliveSessions.filter(
    (s) => s.state === 'active' && !s.dying,
  ).length;

  if (loading) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-3 px-6 py-2 border-b border-gray-800 shrink-0 flex-wrap">
        <h1 className="text-lg font-semibold">Office</h1>
        <span className="text-xs text-gray-500">{activeCount} active</span>
        {tracksWithSessions.length > 0 && (
          <div className="flex items-center gap-1.5 ml-2 flex-wrap">
            <button
              onClick={() => setFilterTrackId(null)}
              className={`px-2.5 py-0.5 rounded text-xs transition-colors ${
                filterTrackId === null
                  ? 'bg-gray-600 text-gray-100'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
              }`}
            >
              All
            </button>
            {tracksWithSessions.map((t) => (
              <button
                key={t.id}
                onClick={() => setFilterTrackId(filterTrackId === t.id ? null : t.id)}
                className={`px-2.5 py-0.5 rounded text-xs transition-colors ${
                  filterTrackId === t.id
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {visibleSessions.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            The office is empty — no active sessions
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {visibleSessions.map((session) => {
              const activityState = getActivityState(session);
              return (
                <OfficeDeskUnit
                  key={session.id}
                  session={session}
                  activityState={activityState}
                  trackName={trackNames[session.trackId] || session.trackId.slice(0, 8)}
                  spriteUrl={null}
                  onAttach={() => setAttachedSession(session)}
                />
              );
            })}
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
