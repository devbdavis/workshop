import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DefaultAiCli, PrMonitor, Session, SessionId, Todo, Track } from '@foundation/types';
import { TerminalPane } from '../terminal-panel/TerminalPane';
import { SessionPanel } from '../track-view/SessionPanel';
import { NewSessionModal, type NewSessionOptions } from '../track-view/NewSessionModal';
import { groupSessionsByTrack } from './group-sessions';
import { TrackNavigator } from './TrackNavigator';

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
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [prMonitors, setPrMonitors] = useState<PrMonitor[]>([]);
  // trackId → first repo path. GET /api/tracks doesn't populate `repos`, only
  // GET /api/tracks/:id does, so these come from per-track detail fetches.
  const [trackRepoPaths, setTrackRepoPaths] = useState<Record<string, string | undefined>>({});
  const [issueBaseUrl, setIssueBaseUrl] = useState<string | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<SessionId[]>(loadSelected);
  // Full track (repos populated) for the New Session modal — fetched on "+" click.
  const [modalTrack, setModalTrack] = useState<Track | null>(null);
  const [defaultAiCli, setDefaultAiCli] = useState<DefaultAiCli>('claude');

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      if (res.ok) setSessions(await res.json());
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  }, []);

  const loadTodos = useCallback(async () => {
    try {
      const res = await fetch('/api/todos');
      if (res.ok) setTodos(await res.json());
    } catch (err) {
      console.error('Failed to load todos:', err);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    loadTodos();
    fetch('/api/tracks')
      .then((r) => (r.ok ? r.json() : []))
      .then(setTracks)
      .catch((err) => console.error('Failed to load tracks:', err));
  }, [loadSessions, loadTodos]);

  // Same issue-tracker settings source TrackView uses for its pane link buttons.
  useEffect(() => {
    fetch('/api/settings/issue-tracker')
      .then((r) => r.json())
      .then(({ tracker, orgName }: { tracker: string; orgName: string }) => {
        if (tracker === 'linear' && orgName.trim()) {
          setIssueBaseUrl(`https://linear.app/${orgName.trim()}/issue/`);
        } else if (tracker === 'jira' && orgName.trim()) {
          setIssueBaseUrl(`https://${orgName.trim()}.atlassian.net/browse/`);
        } else {
          setIssueBaseUrl(undefined);
        }
      })
      .catch(() => { /* silently skip — no issue tracker configured */ });
  }, []);

  useEffect(() => {
    fetch('/api/settings/default-ai-cli')
      .then((r) => r.json())
      .then((d: { provider: DefaultAiCli }) => setDefaultAiCli(d.provider))
      .catch(() => { /* keep default */ });
  }, []);

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
        if (event.type?.startsWith('todo:')) loadTodos();
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, [loadSessions, loadTodos]);

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

  // PR monitors + repo paths for the distinct tracks among selected sessions (max 2 requests each).
  // Keyed on the derived track IDs, not selectedIds: on first mount the selection is restored from
  // localStorage before /api/sessions resolves, so a selectedIds-keyed callback would capture an
  // empty selectedSessions and never refetch once the sessions arrive.
  const selectedTrackKey = [...new Set(selectedSessions.map((s) => s.trackId))].sort().join(',');
  const loadSelectedTrackData = useCallback(async () => {
    const trackIds = selectedTrackKey ? selectedTrackKey.split(',') : [];
    if (trackIds.length === 0) {
      setPrMonitors([]);
      return;
    }
    try {
      const [monitorResults, trackResults] = await Promise.all([
        Promise.all(
          trackIds.map((trackId): Promise<PrMonitor[]> =>
            fetch(`/api/tracks/${trackId}/pr-monitors`).then((r) => (r.ok ? r.json() : [])),
          ),
        ),
        Promise.all(
          trackIds.map((trackId): Promise<Track | null> =>
            fetch(`/api/tracks/${trackId}`).then((r) => (r.ok ? r.json() : null)),
          ),
        ),
      ]);
      setPrMonitors(monitorResults.flat());
      setTrackRepoPaths(
        Object.fromEntries(
          trackResults.filter((t): t is Track => t !== null).map((t) => [t.id, t.repos?.[0]?.path]),
        ),
      );
    } catch (err) {
      console.error('Failed to load track data:', err);
    }
  }, [selectedTrackKey]);

  useEffect(() => {
    loadSelectedTrackData();
  }, [loadSelectedTrackData]);

  const reload = useCallback(() => {
    loadTodos();
    loadSelectedTrackData();
  }, [loadTodos, loadSelectedTrackData]);

  async function destroySession(session: Session) {
    try {
      await fetch(`/api/tracks/${session.trackId}/sessions/${session.id}`, { method: 'DELETE' });
      setSelectedIds((prev) => prev.filter((id) => id !== session.id));
      loadSessions();
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  }

  async function renameSession(session: Session, name: string) {
    try {
      await fetch(`/api/tracks/${session.trackId}/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      loadSessions();
    } catch (err) {
      console.error('Failed to rename session:', err);
    }
  }

  async function openNewSession(trackId: string) {
    try {
      const res = await fetch(`/api/tracks/${trackId}`);
      if (res.ok) setModalTrack(await res.json());
    } catch (err) {
      console.error('Failed to load track:', err);
    }
  }

  async function createSession(opts: NewSessionOptions): Promise<Session | null> {
    if (!modalTrack) return null;
    try {
      const res = await fetch(`/api/tracks/${modalTrack.id}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      });
      if (res.ok) {
        const session: Session = await res.json();
        setSelectedIds([session.id]);
        loadSessions();
        return session;
      }
    } catch (err) {
      console.error('Failed to create session:', err);
    }
    return null;
  }

  return (
    <div className="h-full flex">
      <aside className="w-80 border-r border-gray-800 overflow-y-auto shrink-0">
        {/* Navigator first — fixed position so click targets don't shift when the
            variable-height session panel below changes with each selection. */}
        <TrackNavigator
          groups={groups}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          onNewSession={openNewSession}
        />

        {selectedSessions.length > 0 && (
          <div className="border-t border-gray-800">
            <SessionPanel
              sessions={selectedSessions}
              todos={todos}
              prMonitors={prMonitors}
              onOpenTodo={(todo) => navigate(`/tracks/${todo.trackId}`)}
              onRefresh={reload}
            />
          </div>
        )}
      </aside>

      <main className="flex-1 overflow-hidden flex">
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
              <TerminalPane
                trackId={session.trackId}
                session={session}
                todos={todos}
                onDestroy={() => destroySession(session)}
                onRename={(name) => renameSession(session, name)}
                defaultOpenPath={trackRepoPaths[session.trackId]}
                autoFocus={i === 0}
                issueBaseUrl={issueBaseUrl}
              />
            </div>
          ))
        )}
      </main>

      {modalTrack && (
        <NewSessionModal
          track={modalTrack}
          todos={todos.filter((t) => t.trackId === modalTrack.id)}
          defaultProvider={defaultAiCli}
          onClose={() => setModalTrack(null)}
          onCreate={createSession}
          onTodosChanged={loadTodos}
        />
      )}
    </div>
  );
}
