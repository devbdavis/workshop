import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DefaultAiCli, PrMonitor, Session, SessionId, Todo, Track } from '@foundation/types';
import { issueBaseUrlFor } from '@foundation/issue-tracker.js';
import { TerminalPane } from '../terminal-panel/TerminalPane';
import { SessionPanel } from '../track-view/SessionPanel';
import { NewSessionModal, type NewSessionOptions } from '../track-view/NewSessionModal';
import type { DispatchOptions } from '../track-view/DispatchDropdown';
import { TodoDetailModal } from '../kanban/TodoDetailModal';
import { LinearTicketModal } from '../kanban/LinearTicketModal';
import { groupSessionsByTrack, isVisibleTrack, sortTracks } from './group-sessions';
import { TrackNavigator } from './TrackNavigator';
import { NewSessionPicker } from './NewSessionPicker';

const SELECTED_KEY = 'workshop:overview-selected';

function loadSelected(): SessionId | null {
  try {
    const raw = localStorage.getItem(SELECTED_KEY);
    // Ignore the legacy multi-select format (a JSON array of ids).
    return raw && !raw.startsWith('[') ? (raw as SessionId) : null;
  } catch {
    return null;
  }
}

export function SessionOverview() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [prMonitors, setPrMonitors] = useState<PrMonitor[]>([]);
  // First repo path of the selected session's track. GET /api/tracks doesn't
  // populate `repos`, only GET /api/tracks/:id does, so this comes from a
  // per-track detail fetch.
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | undefined>(undefined);
  const [issueBaseUrl, setIssueBaseUrl] = useState<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<SessionId | null>(loadSelected);
  // Full track (repos populated) for the New Session modal — fetched on "+" click.
  const [modalTrack, setModalTrack] = useState<Track | null>(null);
  const [defaultAiCli, setDefaultAiCli] = useState<DefaultAiCli>('claude');
  const [selectedTodo, setSelectedTodo] = useState<Todo | null>(null);
  const [linearTicketTodoId, setLinearTicketTodoId] = useState<string | null>(null);

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
        setIssueBaseUrl(issueBaseUrlFor(tracker, orgName));
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

  const groups = groupSessionsByTrack(sessions, tracks);
  const selectedSession = groups.flatMap((g) => g.sessions).find((s) => s.id === selectedId);

  // Keep the selection pointing at a navigator-visible session: if nothing is
  // selected (or the selected session died / its track was hidden), fall back
  // to the first visible session. Validated against the same filtered set the
  // render uses, and only after both fetches have had a chance to populate.
  useEffect(() => {
    if (sessions.length === 0 || tracks.length === 0) return;
    const visible = groupSessionsByTrack(sessions, tracks).flatMap((g) => g.sessions);
    setSelectedId((prev) =>
      prev && visible.some((s) => s.id === prev) ? prev : (visible[0]?.id ?? null),
    );
  }, [sessions, tracks]);

  // Click-through from a session alert (?session=id): select it, then drop the param.
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionParam = searchParams.get('session');
  useEffect(() => {
    if (!sessionParam) return;
    setSelectedId(sessionParam as SessionId);
    setSearchParams({}, { replace: true });
  }, [sessionParam, setSearchParams]);

  useEffect(() => {
    try {
      if (selectedId) localStorage.setItem(SELECTED_KEY, selectedId);
      else localStorage.removeItem(SELECTED_KEY);
    } catch { /* ignore */ }
  }, [selectedId]);

  // PR monitors + repo path for the selected session's track. Keyed on the
  // derived track ID, not selectedId: on first mount the selection is restored
  // from localStorage before /api/sessions resolves, so a selectedId-keyed
  // callback would capture an undefined selectedSession and never refetch once
  // the sessions arrive.
  const selectedTrackId = selectedSession?.trackId ?? '';
  const loadSelectedTrackData = useCallback(async () => {
    if (!selectedTrackId) {
      setPrMonitors([]);
      setSelectedRepoPath(undefined);
      return;
    }
    try {
      const [monitorRes, trackRes] = await Promise.all([
        fetch(`/api/tracks/${selectedTrackId}/pr-monitors`),
        fetch(`/api/tracks/${selectedTrackId}`),
      ]);
      setPrMonitors(monitorRes.ok ? await monitorRes.json() : []);
      const track: Track | null = trackRes.ok ? await trackRes.json() : null;
      setSelectedRepoPath(track?.repos?.[0]?.path);
    } catch (err) {
      console.error('Failed to load track data:', err);
    }
  }, [selectedTrackId]);

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
      setSelectedId((prev) => (prev === session.id ? null : prev));
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
        setSelectedId(session.id);
        loadSessions();
        return session;
      }
    } catch (err) {
      console.error('Failed to create session:', err);
    }
    return null;
  }

  async function handleSaveTodo(todoId: string, data: Partial<Todo>) {
    await fetch(`/api/todos/${todoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setSelectedTodo(null);
    reload();
  }

  async function handleDeleteTodo(todoId: string) {
    await fetch(`/api/todos/${todoId}`, { method: 'DELETE' });
    setSelectedTodo(null);
    reload();
  }

  async function handleDispatchTodo(todoId: string, opts: DispatchOptions, formData?: Partial<Todo>) {
    if (formData) {
      await fetch(`/api/todos/${todoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
    }
    await fetch(`/api/todos/${todoId}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    setSelectedTodo(null);
    reload();
  }

  return (
    <div className="h-full flex">
      <aside className="w-80 border-r border-gray-800 overflow-y-auto shrink-0">
        <div className="flex items-center justify-between px-3 pt-3">
          <span className="text-xs font-semibold text-gray-300">Sessions</span>
          <NewSessionPicker tracks={sortTracks(tracks.filter(isVisibleTrack))} onPick={openNewSession} />
        </div>
        {/* Navigator first — fixed position so click targets don't shift when the
            variable-height session panel below changes with each selection. */}
        <TrackNavigator groups={groups} selectedId={selectedId} onSelect={setSelectedId} />

        {selectedSession && (
          <div className="border-t border-gray-800">
            <SessionPanel
              sessions={[selectedSession]}
              todos={todos}
              prMonitors={prMonitors}
              issueBaseUrl={issueBaseUrl}
              onOpenTodo={setSelectedTodo}
              onRefresh={reload}
            />
          </div>
        )}
      </aside>

      <main className="flex-1 overflow-hidden flex flex-col min-h-0">
        {!selectedSession ? (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <p>No active sessions</p>
          </div>
        ) : (
          <TerminalPane
            key={selectedSession.id}
            trackId={selectedSession.trackId}
            session={selectedSession}
            todos={todos}
            onDestroy={() => destroySession(selectedSession)}
            onRename={(name) => renameSession(selectedSession, name)}
            defaultOpenPath={selectedRepoPath}
            autoFocus
            issueBaseUrl={issueBaseUrl}
          />
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

      {selectedTodo !== null && (
        <TodoDetailModal
          todo={selectedTodo}
          tracks={tracks}
          onClose={() => setSelectedTodo(null)}
          onSave={handleSaveTodo}
          onDelete={handleDeleteTodo}
          onDispatch={handleDispatchTodo}
          onTicketCreationStarted={setLinearTicketTodoId}
        />
      )}

      {linearTicketTodoId && (
        <LinearTicketModal todoId={linearTicketTodoId} onClose={() => setLinearTicketTodoId(null)} />
      )}
    </div>
  );
}
