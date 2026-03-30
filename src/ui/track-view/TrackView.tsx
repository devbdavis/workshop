import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { Track, Session, SessionProvider, TrackSummary, ExternalTicket, Todo, PermissionRequest } from '@foundation/types';
import { SummaryPanel } from './SummaryPanel';
import { ContextPanel } from './ContextPanel';
import { TicketPanel } from './TicketPanel';
import { TodoPanel } from './TodoPanel';
import { TrackConfig } from './TrackConfig';
import { PermissionPanel } from './PermissionPanel';
import { TerminalArea } from '../terminal-panel/TerminalArea';

export function TrackView() {
  const { trackId } = useParams<{ trackId: string }>();
  const [track, setTrack] = useState<Track | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [summary, setSummary] = useState<TrackSummary | null>(null);
  const [tickets, setTickets] = useState<ExternalTicket[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'context' | 'todos' | 'config'>('context');
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');

  const loadTrack = useCallback(async () => {
    if (!trackId) return;
    try {
      const [trackRes, sessionsRes, summaryRes, ticketsRes, todosRes] = await Promise.all([
        fetch(`/api/tracks/${trackId}`),
        fetch(`/api/tracks/${trackId}/sessions`),
        fetch(`/api/tracks/${trackId}/summary`),
        fetch(`/api/tracks/${trackId}/tickets`),
        fetch(`/api/tracks/${trackId}/todos`),
      ]);
      if (trackRes.ok) setTrack(await trackRes.json());
      if (sessionsRes.ok) {
        const loadedSessions: Session[] = await sessionsRes.json();
        setSessions(loadedSessions);
        // Fetch pending permissions for all background sessions
        loadPermissions(loadedSessions.filter((s) => s.background));
      }
      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (ticketsRes.ok) setTickets(await ticketsRes.json());
      if (todosRes.ok) setTodos(await todosRes.json());
    } catch (err) {
      console.error('Failed to load track:', err);
    } finally {
      setLoading(false);
    }
  }, [trackId]);

  async function loadPermissions(bgSessions: Session[]) {
    const allPending: PermissionRequest[] = [];
    for (const s of bgSessions) {
      try {
        const res = await fetch(`/api/permissions?sessionId=${s.id}&status=pending`);
        if (res.ok) {
          const perms = await res.json();
          allPending.push(...perms);
        }
      } catch {
        // ignore
      }
    }
    setPendingPermissions(allPending);
  }

  useEffect(() => {
    loadTrack();
  }, [loadTrack]);

  // Subscribe to WebSocket events — permission events trigger faster polling
  useEffect(() => {
    if (!trackId) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data);
        if (event.trackId === trackId || event.type?.startsWith('permission:')) {
          loadTrack();
        }
      } catch {
        // ignore malformed messages
      }
    };
    return () => ws.close();
  }, [trackId, loadTrack]);

  async function createSession(provider: SessionProvider = 'claude'): Promise<Session | null> {
    if (!trackId) return null;
    try {
      const res = await fetch(`/api/tracks/${trackId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      if (res.ok) {
        const session: Session = await res.json();
        setSessions((prev) => [...prev, session]);
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
    } catch (err) {
      console.error('Failed to destroy session:', err);
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

  async function resolvePermission(id: string, decision: 'approved' | 'denied', comment?: string) {
    try {
      await fetch(`/api/permissions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, comment }),
      });
      // Remove from local state immediately for snappy UX
      setPendingPermissions((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error('Failed to resolve permission:', err);
    }
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

  async function allowAllForSession(sessionId: string) {
    try {
      await fetch(`/api/permissions/sessions/${sessionId}/auto-approve`, { method: 'POST' });
      // Clear all pending permissions for this session from local state
      setPendingPermissions((prev) => prev.filter((p) => p.sessionId !== sessionId));
    } catch (err) {
      console.error('Failed to set auto-approve:', err);
    }
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
        {pendingPermissions.length > 0 && (
          <span className="text-xs bg-amber-900 text-amber-300 px-2 py-0.5 rounded animate-pulse">
            {pendingPermissions.length} pending
          </span>
        )}
        <div className="ml-auto">
          <NewSessionButton onCreateSession={createSession} />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 border-r border-gray-800 overflow-y-auto shrink-0">
          <SummaryPanel summary={summary} trackId={track.id} onRefresh={loadTrack} />

          <div className="flex border-b border-gray-800">
            <button
              onClick={() => setSidebarTab('context')}
              className={`flex-1 px-3 py-2 text-xs font-medium ${sidebarTab === 'context' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
            >
              Context
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

          {sidebarTab === 'context' ? (
            <>
              <TicketPanel trackId={track.id} tickets={tickets} onUpdate={loadTrack} />
              <ContextPanel track={track} onUpdate={loadTrack} />
            </>
          ) : sidebarTab === 'todos' ? (
            <TodoPanel track={track} todos={todos} sessions={sessions} onUpdate={loadTrack} />
          ) : (
            <TrackConfig track={track} onUpdate={loadTrack} />
          )}
        </aside>

        <main className="flex-1 overflow-hidden flex flex-col">
          <PermissionPanel
            requests={pendingPermissions}
            onResolve={resolvePermission}
            onAllowAllForSession={allowAllForSession}
          />
          <div className="flex-1 min-h-0">
            <TerminalArea
              trackId={track.id}
              sessions={sessions}
              onDestroySession={destroySession}
              onCreateSession={() => createSession()}
              onRenameSession={renameSession}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

function NewSessionButton({ onCreateSession }: { onCreateSession: (provider: SessionProvider) => Promise<Session | null> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={() => onCreateSession('claude')}
        className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded-l-lg transition-colors"
      >
        New Session
      </button>
      <button
        onClick={() => setOpen(!open)}
        className="px-1.5 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded-r-lg border-l border-blue-500 transition-colors"
      >
        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
          <path d="M3 5l3 3 3-3H3z" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
          <button
            onClick={() => { onCreateSession('claude'); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 flex items-center gap-2"
          >
            <span className="w-2 h-2 rounded-full bg-orange-400" />
            Claude
          </button>
          <button
            onClick={() => { onCreateSession('codex'); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 flex items-center gap-2"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Codex
          </button>
        </div>
      )}
    </div>
  );
}
