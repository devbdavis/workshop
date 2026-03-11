import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { Track, Session, TrackSummary } from '@foundation/types';
import { SummaryPanel } from './SummaryPanel';
import { ContextPanel } from './ContextPanel';
import { TerminalArea } from '../terminal-panel/TerminalArea';

export function TrackView() {
  const { trackId } = useParams<{ trackId: string }>();
  const [track, setTrack] = useState<Track | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [summary, setSummary] = useState<TrackSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const loadTrack = useCallback(async () => {
    if (!trackId) return;
    try {
      const [trackRes, sessionsRes, summaryRes] = await Promise.all([
        fetch(`/api/tracks/${trackId}`),
        fetch(`/api/tracks/${trackId}/sessions`),
        fetch(`/api/tracks/${trackId}/summary`),
      ]);
      if (trackRes.ok) setTrack(await trackRes.json());
      if (sessionsRes.ok) setSessions(await sessionsRes.json());
      if (summaryRes.ok) setSummary(await summaryRes.json());
    } catch (err) {
      console.error('Failed to load track:', err);
    } finally {
      setLoading(false);
    }
  }, [trackId]);

  useEffect(() => {
    loadTrack();
  }, [loadTrack]);

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
          <ContextPanel track={track} />
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
