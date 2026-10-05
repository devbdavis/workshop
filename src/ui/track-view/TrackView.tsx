import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import type { Track, Session, SessionId, ExternalTicket, Todo, DefaultAiCli, PrMonitor, TodoId } from '@foundation/types';
import { issueBaseUrlFor } from '@foundation/issue-tracker.js';
import type { DispatchOptions } from './DispatchDropdown';
import { ContextPanel } from './ContextPanel';
import { TicketPanel } from './TicketPanel';
import { TodoPanel } from './TodoPanel';
import { TrackConfig } from './TrackConfig';
import { SessionPanel } from './SessionPanel';
import { NewSessionModal, type NewSessionOptions } from './NewSessionModal';
import { TodoDetailModal } from '../kanban/TodoDetailModal';
import { LinearTicketModal } from '../kanban/LinearTicketModal';
import { TerminalArea } from '../terminal-panel/TerminalArea';
import { useIsMobile } from '../use-is-mobile';

export function TrackView() {
  const { trackId } = useParams<{ trackId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [track, setTrack] = useState<Track | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [tickets, setTickets] = useState<ExternalTicket[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [prMonitors, setPrMonitors] = useState<PrMonitor[]>([]);
  const [deletedSessions, setDeletedSessions] = useState<Session[]>([]);
  const [activeSessionIds, setActiveSessionIds] = useState<SessionId[]>([]);
  const [loading, setLoading] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'session' | 'todos' | 'config'>('session');
  const [selectedTodo, setSelectedTodo] = useState<Todo | null>(null);
  const [linearTicketTodoId, setLinearTicketTodoId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [pendingSelectSessionId, setPendingSelectSessionId] = useState<SessionId | null>(null);
  const [issueBaseUrl, setIssueBaseUrl] = useState<string | undefined>(undefined);
  const [defaultAiCli, setDefaultAiCli] = useState<DefaultAiCli>('claude');
  // Session IDs that have been created but whose tmux/CLI init is still in progress.
  // Cleared when session:ready arrives for that session.
  const [startingSessions, setStartingSessions] = useState<Set<string>>(new Set());
  // A fast init (e.g. a shell) can broadcast session:ready before session:created or the
  // POST response lands; remembering it stops those from re-marking the session as starting.
  const readySessionsRef = useRef(new Set<string>());
  const markStarting = useCallback((id: string) => {
    if (!readySessionsRef.current.has(id)) setStartingSessions((prev) => new Set([...prev, id]));
  }, []);
  const [showNewSession, setShowNewSession] = useState(false);
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const loadTrack = useCallback(async () => {
    if (!trackId) return;
    try {
      const [trackRes, sessionsRes, ticketsRes, todosRes, deletedRes, prMonitorsRes] = await Promise.all([
        fetch(`/api/tracks/${trackId}`),
        fetch(`/api/tracks/${trackId}/sessions`),
        fetch(`/api/tracks/${trackId}/tickets`),
        fetch(`/api/tracks/${trackId}/todos`),
        fetch(`/api/tracks/${trackId}/sessions/deleted`),
        fetch(`/api/tracks/${trackId}/pr-monitors`),
      ]);
      if (trackRes.ok) setTrack(await trackRes.json());
      if (sessionsRes.ok) {
        const loadedSessions: Session[] = await sessionsRes.json();
        setSessions(loadedSessions);
      }
      if (ticketsRes.ok) setTickets(await ticketsRes.json());
      if (todosRes.ok) setTodos(await todosRes.json());
      if (deletedRes.ok) setDeletedSessions(await deletedRes.json());
      if (prMonitorsRes.ok) setPrMonitors(await prMonitorsRes.json());
    } catch (err) {
      console.error('Failed to load track:', err);
    } finally {
      setLoading(false);
    }
  }, [trackId]);

  useEffect(() => {
    loadTrack();
  }, [loadTrack]);

  // Click-through from a session alert (?session=id) — select the pane, then
  // drop the param so it doesn't re-fire on refresh or re-navigation.
  useEffect(() => {
    const sessionParam = searchParams.get('session');
    if (!sessionParam) return;
    setPendingSelectSessionId(sessionParam as SessionId);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('session');
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  // Fetch global issue tracker config once on mount — independent of track reloads.
  useEffect(() => {
    fetch('/api/settings/issue-tracker')
      .then((r) => r.json())
      .then(({ tracker, orgName }: { tracker: string; orgName: string }) => {
        setIssueBaseUrl(issueBaseUrlFor(tracker, orgName));
      })
      .catch(() => { /* silently skip — no issue tracker configured */ });
  }, []);

  useEffect(() => {
    function loadDefaultCli() {
      fetch('/api/settings/default-ai-cli')
        .then((r) => r.json())
        .then((d: { provider: DefaultAiCli }) => setDefaultAiCli(d.provider))
        .catch(() => { /* keep default */ });
    }
    loadDefaultCli();
    window.addEventListener('focus', loadDefaultCli);
    return () => window.removeEventListener('focus', loadDefaultCli);
  }, []);

  // Subscribe to WebSocket events. Auto-reconnects on disconnect (e.g. server restart)
  // and reloads on reconnect to catch any events missed while disconnected.
  useEffect(() => {
    if (!trackId) return;
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
      ws.onopen = () => { loadTrack(); };
      ws.onmessage = (evt) => {
        try {
          const event = JSON.parse(evt.data) as { type: string; trackId: string; sessionId?: string; sessionName?: string; timestamp?: string };
          if (event.trackId !== trackId) return;
          // Alert-only events — the global SessionAlertsProvider handles toasts/notifications.
          if (event.type === 'session:idle-alert' || event.type === 'session:needs-input') {
            return;
          } else if (event.type === 'session:created' && event.sessionId) {
            markStarting(event.sessionId);
            loadTrack();
          } else if (event.type === 'session:ready' && event.sessionId) {
            readySessionsRef.current.add(event.sessionId);
            setStartingSessions((prev) => {
              const next = new Set(prev);
              next.delete(event.sessionId!);
              return next;
            });
            loadTrack();
          } else {
            loadTrack();
          }
        } catch {
          // ignore malformed messages
        }
      };
      ws.onclose = () => {
        if (!cancelled) reconnectTimer = setTimeout(connect, 2_000);
      };
    }

    connect();
    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [trackId, loadTrack, markStarting]);

  /**
   * `select` drives whether the new session takes over the pane selection. A
   * terminal opened into the floating modal must not — it only becomes a pane
   * once the user docks it.
   */
  async function createSession(opts: NewSessionOptions, select = true): Promise<Session | null> {
    if (!trackId) return null;
    try {
      const res = await fetch(`/api/tracks/${trackId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      });
      if (res.ok) {
        const session: Session = await res.json();
        setSessions((prev) => [...prev, session]);
        // Mark as starting immediately — cleared when session:ready arrives.
        markStarting(session.id);
        if (select) setPendingSelectSessionId(session.id);
        return session;
      }
    } catch (err) {
      console.error('Failed to create session:', err);
    }
    return null;
  }

  async function destroySession(sessionId: string) {
    if (!trackId) return;
    try {
      await fetch(`/api/tracks/${trackId}/sessions/${sessionId}`, { method: 'DELETE' });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      // Refresh the deleted list so the panel count updates immediately
      const res = await fetch(`/api/tracks/${trackId}/sessions/deleted`);
      if (res.ok) setDeletedSessions(await res.json());
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  }

  async function restoreSession(sessionId: string) {
    if (!trackId) return;
    try {
      const res = await fetch(`/api/tracks/${trackId}/sessions/${sessionId}/restore`, { method: 'POST' });
      if (res.ok) {
        const restored: Session = await res.json();
        setSessions((prev) => [...prev, restored]);
        setDeletedSessions((prev) => prev.filter((s) => s.id !== sessionId));
      }
    } catch (err) {
      console.error('Failed to restore session:', err);
    }
  }

  async function purgeSession(sessionId: string) {
    if (!trackId) return;
    try {
      await fetch(`/api/tracks/${trackId}/sessions/${sessionId}/purge`, { method: 'DELETE' });
      setDeletedSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      console.error('Failed to purge session:', err);
    }
  }

  async function renameSession(sessionId: string, name: string) {
    if (!trackId) return;
    try {
      const res = await fetch(`/api/tracks/${trackId}/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const updated: Session = await res.json();
        setSessions((prev) => prev.map((s) => (s.id === sessionId ? updated : s)));
      }
    } catch (err) {
      console.error('Failed to rename session:', err);
    }
  }

  async function handleSaveTodo(todoId: string, data: Partial<Todo>) {
    await fetch(`/api/todos/${todoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setSelectedTodo(null);
    loadTrack();
  }

  async function handleDeleteTodo(todoId: string) {
    await fetch(`/api/todos/${todoId}`, { method: 'DELETE' });
    setSelectedTodo(null);
    loadTrack();
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
    loadTrack();
  }

  async function saveTrackName() {
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === track?.name) { setEditingName(false); return; }
    try {
      const res = await fetch(`/api/tracks/${trackId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) setTrack(await res.json());
    } catch (err) {
      console.error('Failed to rename track:', err);
    }
    setEditingName(false);
  }

  if (loading) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  if (!track) {
    return (
      <div className="p-8">
        <p className="text-gray-400">Track not found.</p>
        <Link to="/" className="text-blue-400 hover:text-blue-300 mt-2 inline-block">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-4 px-6 py-2 border-b border-gray-800 shrink-0">
        {editingName ? (
          <input
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={saveTrackName}
            onKeyDown={(e) => { if (e.key === 'Enter') saveTrackName(); if (e.key === 'Escape') setEditingName(false); }}
            className="text-lg font-semibold bg-gray-800 border border-gray-600 rounded px-2 py-0.5 outline-none focus:border-blue-500"
          />
        ) : (
          <h1
            className="text-lg font-semibold cursor-pointer hover:text-blue-300 transition-colors"
            title="Click to rename"
            onClick={() => { setNameValue(track.name); setEditingName(true); }}
          >
            {track.name}
          </h1>
        )}
        <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{track.status}</span>
        <button
          onClick={() => setDrawerOpen(true)}
          className="md:hidden px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
        >
          Sessions
        </button>
        <div className="ml-auto">
          <button
            onClick={() => setShowNewSession(true)}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
          >
            New Session
          </button>
        </div>
      </header>

      <div className="relative flex flex-1 overflow-hidden">
        {/* Mobile-only backdrop; closes the slide-over drawer on tap */}
        {isMobile && drawerOpen && (
          <div
            className="md:hidden absolute inset-0 z-30 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
        )}
        <aside
          className={`absolute inset-y-0 left-0 z-40 w-80 max-w-[85vw] bg-gray-950 border-r border-gray-800 overflow-y-auto md:static md:z-auto md:max-w-none md:shrink-0 md:block ${
            drawerOpen ? '' : 'hidden'
          }`}
        >
          <div className="flex border-b border-gray-800">
            <button
              onClick={() => setSidebarTab('session')}
              className={`flex-1 px-3 py-2 text-xs font-medium ${sidebarTab === 'session' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
            >
              Session
              {sessions.length > 0 && (
                <span className="ml-1 text-[10px] bg-gray-800 text-gray-400 px-1 py-0.5 rounded">
                  {sessions.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setSidebarTab('todos')}
              className={`flex-1 px-3 py-2 text-xs font-medium ${sidebarTab === 'todos' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
            >
              Todos
              {todos.filter((t) => t.status !== 'done').length > 0 && (
                <span className="ml-1 text-[10px] bg-blue-900 text-blue-300 px-1 py-0.5 rounded">
                  {todos.filter((t) => t.status !== 'done').length}
                </span>
              )}
            </button>
            <button
              onClick={() => setSidebarTab('config')}
              className={`flex-1 px-3 py-2 text-xs font-medium ${sidebarTab === 'config' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
            >
              Config
            </button>
          </div>

          {sidebarTab === 'session' ? (
            <SessionPanel
              sessions={activeSessionIds.length > 0 ? sessions.filter((s) => activeSessionIds.includes(s.id)) : sessions.slice(0, 1)}
              todos={todos}
              prMonitors={prMonitors}
              onOpenTodo={setSelectedTodo}
              onRefresh={loadTrack}
            />
          ) : sidebarTab === 'todos' ? (
            <TodoPanel track={track} todos={todos} sessions={sessions} onUpdate={loadTrack} />
          ) : (
            <>
              <TicketPanel trackId={track.id} tickets={tickets} onUpdate={loadTrack} />
              <ContextPanel track={track} onUpdate={loadTrack} />
              <TrackConfig track={track} onUpdate={loadTrack} />
            </>
          )}
        </aside>

        <main className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 min-h-0">
            <TerminalArea
              trackId={track.id}
              trackName={track.name}
              sessions={sessions}
              todos={todos}
              deletedSessions={deletedSessions}
              issueBaseUrl={issueBaseUrl}
              startingSessions={startingSessions}
              pendingSelectSessionId={pendingSelectSessionId}
              onDestroySession={destroySession}
              onRenameSession={renameSession}
              onRestoreSession={restoreSession}
              onPurgeSession={purgeSession}
              defaultOpenPath={track.repos?.[0]?.path}
              onSelectionChange={setActiveSessionIds}
            />
          </div>
        </main>
      </div>

      {showNewSession && (
        <NewSessionModal
          track={track}
          todos={todos}
          defaultProvider={defaultAiCli}
          onClose={() => setShowNewSession(false)}
          onCreate={createSession}
          onTodosChanged={loadTrack}
        />
      )}

      {selectedTodo !== null && (
        <TodoDetailModal
          todo={selectedTodo}
          tracks={[track]}
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

