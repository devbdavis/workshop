import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { Track, Session, TrackSummary, ExternalTicket, Todo } from '@foundation/types';
import { SummaryPanel } from './SummaryPanel';
import { ContextPanel } from './ContextPanel';
import { TicketPanel } from './TicketPanel';
import { TodoPanel } from './TodoPanel';
import { TrackConfig } from './TrackConfig';
import { TerminalArea } from '../terminal-panel/TerminalArea';

export function TrackView() {
  const { trackId } = useParams<{ trackId: string }>();
  const [track, setTrack] = useState<Track | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [summary, setSummary] = useState<TrackSummary | null>(null);
  const [tickets, setTickets] = useState<ExternalTicket[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'context' | 'todos' | 'config'>('context');

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
      if (sessionsRes.ok) setSessions(await sessionsRes.json());
      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (ticketsRes.ok) setTickets(await ticketsRes.json());
      if (todosRes.ok) setTodos(await todosRes.json());
    } catch (err) {
      console.error('Failed to load track:', err);
    } finally {
      setLoading(false);
    }
  }, [trackId]);

  useEffect(() => {
    loadTrack();
  }, [loadTrack]);

  // Subscribe to server-sent events so external changes (MCP, API) trigger a re-render
  useEffect(() => {
    if (!trackId) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data);
        if (event.trackId === trackId) {
          loadTrack();
        }
      } catch {
        // ignore malformed messages
      }
    };
    return () => ws.close();
  }, [trackId, loadTrack]);

  async function createSession() {
    if (!trackId) return;
    try {
      const res = await fetch(`/api/tracks/${trackId}/sessions`, { method: 'POST' });
      if (res.ok) {
        const session = await res.json();
        setSessions((prev) => [...prev, session]);
      }
    } catch (err) {
      console.error('Failed to create session:', err);
    }
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
    <div className="h-screen flex flex-col">
      <header className="flex items-center gap-4 px-6 py-3 border-b border-gray-800 shrink-0">
        <Link to="/" className="text-gray-400 hover:text-gray-200 text-sm">
          &larr; Dashboard
        </Link>
        <h1 className="text-lg font-semibold">{track.name}</h1>
        <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{track.status}</span>
        <div className="ml-auto">
          <button
            onClick={createSession}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
          >
            New Session
          </button>
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
            <TodoPanel trackId={track.id} todos={todos} onUpdate={loadTrack} />
          ) : (
            <TrackConfig track={track} onUpdate={loadTrack} />
          )}
        </aside>

        <main className="flex-1 overflow-hidden">
          <TerminalArea
            trackId={track.id}
            sessions={sessions}
            onDestroySession={destroySession}
          />
        </main>
      </div>
    </div>
  );
}
