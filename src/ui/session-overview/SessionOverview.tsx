import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Session, SessionId, Track } from '@foundation/types';
import { TerminalPanel } from '../terminal-panel/TerminalPanel';
import { ActivityDot } from '@ui/shared/ActivityDot';
import { groupSessionsByTrack } from './group-sessions';
import { SessionTile } from './SessionTile';

const SELECTED_KEY = 'workshop:overview-selected';

function loadSelected(): SessionId[] {
  try {
    const raw = localStorage.getItem(SELECTED_KEY);
    return raw ? (JSON.parse(raw) as SessionId[]) : [];
  } catch {
    return [];
  }
}

export function SessionOverview() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedIds, setSelectedIds] = useState<SessionId[]>(loadSelected);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) setSessions(await res.json());
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    fetch('/api/tracks')
      .then((r) => (r.ok ? r.json() : []))
      .then(setTracks)
      .catch((err) => console.error('Failed to load tracks:', err));
  }, [loadSessions]);

  // Reuses the same inline WebSocket-subscription pattern every other page in
  // this app uses (TrackView, Dashboard, TopNav) — there is no shared hook to
  // extract it into.
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data) as { type: string };
        if (event.type?.startsWith('session:')) loadSessions();
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, [loadSessions]);

  // Drop selected IDs that no longer exist (session deleted/purged elsewhere).
  useEffect(() => {
    if (sessions.length === 0) return;
    const validIds = new Set(sessions.map((s) => s.id));
    setSelectedIds((prev) => {
      const valid = prev.filter((id) => validIds.has(id));
      return valid.length === prev.length ? prev : valid;
    });
  }, [sessions]);

  useEffect(() => {
    try {
      localStorage.setItem(SELECTED_KEY, JSON.stringify(selectedIds));
    } catch { /* ignore */ }
  }, [selectedIds]);

  // Same click/⌘-click/eviction semantics as TerminalArea's handleSelect —
  // except there's no auto-pick fallback: an empty selection here is a
  // legitimate state ("Select a session to view"), not something to correct.
  const handleSelect = useCallback((id: SessionId, additive: boolean) => {
    setSelectedIds((prev) => {
      if (!additive) {
        return prev.length === 1 && prev[0] === id ? prev : [id];
      }
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return prev.length >= 2 ? [prev[1], id] : [...prev, id];
    });
  }, []);

  const groups = groupSessionsByTrack(sessions, tracks);
  const selectedSessions = selectedIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is Session => s !== undefined);

  return (
    <div className="h-full flex flex-col">
      {/* Tile strip — compact, scrolls vertically when many tracks are active */}
      <div className="shrink-0 max-h-64 overflow-y-auto border-b border-gray-800 px-4 py-3 space-y-3">
        {groups.length === 0 ? (
          <p className="text-xs text-gray-600 italic">No active sessions.</p>
        ) : (
          groups.map(({ track, sessions: trackSessions }) => (
            <div key={track.id}>
              <Link
                to={`/tracks/${track.id}`}
                className="text-xs font-medium text-gray-400 hover:text-blue-300 transition-colors"
              >
                {track.name}
              </Link>
              <div className="flex gap-2 overflow-x-auto pt-1.5 pb-1">
                {trackSessions.map((session) => (
                  <SessionTile
                    key={session.id}
                    session={session}
                    selected={selectedIds.includes(session.id)}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Focused panes — up to 2 live terminals side by side */}
      <div className="flex-1 min-h-0 flex">
        {selectedSessions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <p>Select a session to view</p>
          </div>
        ) : (
          selectedSessions.map((session, i) => (
            <div
              key={session.id}
              className={`min-h-0 min-w-0 overflow-hidden flex flex-col flex-1 ${i > 0 ? 'border-l border-gray-800' : ''}`}
            >
              <div className="flex items-center gap-1.5 px-2 py-0.5 bg-gray-900 border-b border-gray-800 shrink-0 text-xs text-gray-400 font-mono truncate">
                <ActivityDot activityStatus={session.activityStatus} className="shrink-0" />
                {session.name || `session:${session.id.slice(0, 8)}`}
              </div>
              <div className="flex-1 min-h-0">
                <TerminalPanel trackId={session.trackId} sessionId={session.id} autoFocus={i === 0} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
