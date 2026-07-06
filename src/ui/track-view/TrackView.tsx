import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { Track, Session, SessionId, SessionProvider, TrackSummary, ExternalTicket, Todo, DefaultAiCli, PrMonitor, TodoId } from '@foundation/types';
import type { DispatchOptions } from './DispatchDropdown';
import { SummaryPanel } from './SummaryPanel';
import { ContextPanel } from './ContextPanel';
import { TicketPanel } from './TicketPanel';
import { TodoPanel } from './TodoPanel';
import { TrackConfig } from './TrackConfig';
import { SessionPanel } from './SessionPanel';
import { TodoDetailModal } from '../kanban/TodoDetailModal';
import { TerminalArea } from '../terminal-panel/TerminalArea';
import { useAvailableClis } from '../hooks/useAvailableClis';

/** Display metadata for the New Session provider menu, keyed by provider id. */
const PROVIDER_META: Record<SessionProvider, { label: string; color: string }> = {
  claude: { label: 'Claude', color: 'bg-orange-400' },
  cursor: { label: 'Cursor CLI', color: 'bg-violet-400' },
  codex: { label: 'Codex', color: 'bg-emerald-400' },
  gemini: { label: 'Gemini', color: 'bg-blue-400' },
};

interface IdleAlert {
  id: string;
  sessionId: string;
  sessionName: string | undefined;
  timestamp: string;
}

export function TrackView() {
  const { trackId } = useParams<{ trackId: string }>();
  const [track, setTrack] = useState<Track | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [summary, setSummary] = useState<TrackSummary | null>(null);
  const [tickets, setTickets] = useState<ExternalTicket[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [prMonitors, setPrMonitors] = useState<PrMonitor[]>([]);
  const [deletedSessions, setDeletedSessions] = useState<Session[]>([]);
  const [activeSessionIds, setActiveSessionIds] = useState<SessionId[]>([]);
  const [loading, setLoading] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'session' | 'todos' | 'config'>('session');
  const [selectedTodo, setSelectedTodo] = useState<Todo | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [idleAlerts, setIdleAlerts] = useState<IdleAlert[]>([]);
  const [pendingSelectSessionId, setPendingSelectSessionId] = useState<SessionId | null>(null);
  const [issueBaseUrl, setIssueBaseUrl] = useState<string | undefined>(undefined);
  const [defaultAiCli, setDefaultAiCli] = useState<DefaultAiCli>('claude');
  // Session IDs that have been created but whose tmux/CLI init is still in progress.
  // Cleared when session:ready arrives for that session.
  const [startingSessions, setStartingSessions] = useState<Set<string>>(new Set());

  const loadTrack = useCallback(async () => {
    if (!trackId) return;
    try {
      const [trackRes, sessionsRes, summaryRes, ticketsRes, todosRes, deletedRes, prMonitorsRes] = await Promise.all([
        fetch(`/api/tracks/${trackId}`),
        fetch(`/api/tracks/${trackId}/sessions`),
        fetch(`/api/tracks/${trackId}/summary`),
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
      if (summaryRes.ok) setSummary(await summaryRes.json());
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

  // Fetch global issue tracker config once on mount — independent of track reloads.
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
          if (event.type === 'session:idle-alert') {
            const alert: IdleAlert = {
              id: `${event.sessionId}-${Date.now()}`,
              sessionId: event.sessionId ?? '',
              sessionName: event.sessionName,
              timestamp: event.timestamp ?? new Date().toISOString(),
            };
            setIdleAlerts((prev) => [...prev, alert]);
            // Auto-dismiss after 30s
            setTimeout(() => {
              setIdleAlerts((prev) => prev.filter((a) => a.id !== alert.id));
            }, 30_000);
          } else if (event.type === 'session:created' && event.sessionId) {
            setStartingSessions((prev) => new Set([...prev, event.sessionId!]));
            loadTrack();
          } else if (event.type === 'session:ready' && event.sessionId) {
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
  }, [trackId, loadTrack]);

  async function createSession(provider: SessionProvider = defaultAiCli, worktreeMode?: boolean): Promise<Session | null> {
    if (!trackId) return null;
    try {
      const res = await fetch(`/api/tracks/${trackId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, ...(worktreeMode !== undefined ? { worktreeMode } : {}) }),
      });
      if (res.ok) {
        const session: Session = await res.json();
        setSessions((prev) => [...prev, session]);
        // Mark as starting immediately — cleared when session:ready arrives.
        setStartingSessions((prev) => new Set([...prev, session.id]));
        setPendingSelectSessionId(session.id);
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
        <div className="ml-auto">
          <NewSessionButton defaultProvider={defaultAiCli} onCreateSession={createSession} />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 border-r border-gray-800 overflow-y-auto shrink-0">
          <SummaryPanel summary={summary} trackId={track.id} onRefresh={loadTrack} />

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

      {selectedTodo !== null && (
        <TodoDetailModal
          todo={selectedTodo}
          tracks={[track]}
          onClose={() => setSelectedTodo(null)}
          onSave={handleSaveTodo}
          onDelete={handleDeleteTodo}
          onDispatch={handleDispatchTodo}
        />
      )}

      {/* Idle alert toasts — bottom-right, auto-dismiss */}
      {idleAlerts.length > 0 && (
        <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 max-w-xs">
          {idleAlerts.map((alert) => (
            <div
              key={alert.id}
              className="flex items-start gap-2 bg-gray-800 border border-yellow-600/50 rounded-lg px-3 py-2 shadow-lg text-sm"
            >
              <span className="mt-0.5 w-2 h-2 rounded-full bg-yellow-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-gray-200 font-medium truncate">
                  {alert.sessionName ?? `Session ${alert.sessionId.slice(0, 8)}`}
                </p>
                <p className="text-gray-400 text-xs">Idle — waiting for input</p>
              </div>
              <button
                onClick={() => setIdleAlerts((prev) => prev.filter((a) => a.id !== alert.id))}
                className="text-gray-600 hover:text-gray-300 transition-colors shrink-0 mt-0.5"
                aria-label="Dismiss"
              >
                <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NewSessionButton({
  defaultProvider,
  onCreateSession,
}: {
  defaultProvider: DefaultAiCli;
  onCreateSession: (provider: SessionProvider, worktreeMode?: boolean) => Promise<Session | null>;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { clis } = useAvailableClis();

  // Offer only enabled agents (gated via Settings → Available CLIs).
  const enabledProviders = clis
    .filter((c) => c.kind === 'agent' && c.enabled)
    .map((c) => c.provider as SessionProvider);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  async function create(provider: SessionProvider, worktreeMode?: boolean): Promise<void> {
    if (creating) return;
    setCreating(true);
    setOpen(false);
    try {
      await onCreateSession(provider, worktreeMode);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={() => create(defaultProvider, true)}
        disabled={creating}
        className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-70 disabled:cursor-not-allowed rounded-l-lg transition-colors flex items-center gap-1.5"
      >
        {creating && (
          <svg className="w-3 h-3 animate-spin" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 1v2M6 9v2M1 6h2M9 6h2" strokeLinecap="round" />
          </svg>
        )}
        {creating ? 'Starting…' : 'New Session'}
      </button>
      <button
        onClick={() => setOpen(!open)}
        disabled={creating}
        className="px-1.5 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-70 disabled:cursor-not-allowed rounded-r-lg border-l border-blue-500 transition-colors"
      >
        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
          <path d="M3 5l3 3 3-3H3z" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg py-1 z-50 min-w-[160px]">
          {enabledProviders.map((p) => {
            const meta = PROVIDER_META[p];
            return (
              <div key={p}>
                <button
                  onClick={() => create(p, true)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 flex items-center gap-2"
                >
                  <span className={`w-2 h-2 rounded-full ${meta.color}`} />
                  <span>{meta.label} <span className="text-[10px] text-gray-500 ml-0.5">(worktree)</span></span>
                </button>
                <button
                  onClick={() => create(p, false)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 flex items-center gap-2"
                >
                  <span className={`w-2 h-2 rounded-full ${meta.color}`} />
                  {meta.label}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
