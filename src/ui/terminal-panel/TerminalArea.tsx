import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session, SessionId, Todo } from '@foundation/types';
import { TerminalPane } from './TerminalPane';
import { TrackOfficeStrip } from './TrackOfficeStrip';
import { RecentlyDeletedPanel } from './RecentlyDeletedPanel';
import { useIsMobile } from '../use-is-mobile';

interface Props {
  trackId: string;
  trackName: string;
  sessions: Session[];
  todos: Todo[];
  deletedSessions: Session[];
  startingSessions?: Set<string>;
  pendingSelectSessionId?: SessionId | null;
  onDestroySession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  onRestoreSession: (sessionId: string) => void;
  onPurgeSession: (sessionId: string) => void;
  defaultOpenPath?: string;
  onSelectionChange?: (ids: SessionId[]) => void;
  issueBaseUrl?: string;
}

const storageKey = (trackId: string) => `workshop:selected:${trackId}`;

export function TerminalArea({ trackId, trackName, sessions, todos, deletedSessions, startingSessions, pendingSelectSessionId, onDestroySession, onRenameSession, onRestoreSession, onPurgeSession, defaultOpenPath, onSelectionChange, issueBaseUrl }: Props) {
  const [selectedIds, setSelectedIds] = useState<SessionId[]>(() => {
    try {
      const stored = localStorage.getItem(storageKey(trackId));
      if (stored) {
        const ids = JSON.parse(stored) as SessionId[];
        const validIds = new Set(sessions.map((s) => s.id));
        const valid = ids.filter((id) => validIds.has(id));
        if (valid.length > 0) return valid;
      }
    } catch { /* ignore */ }
    const first = sessions.find((s) => !s.background) ?? sessions[0];
    return first ? [first.id] : [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(trackId), JSON.stringify([...selectedIds]));
    } catch { /* ignore */ }
  }, [trackId, selectedIds]);

  // Sync selection when sessions list changes: remove dead sessions, auto-pick if empty.
  const seenIdsRef = useRef(new Set(sessions.map((s) => s.id)));
  useEffect(() => {
    const currentIds = new Set(sessions.map((s) => s.id));

    const incoming = sessions.filter((s) => !seenIdsRef.current.has(s.id));
    incoming.forEach((s) => seenIdsRef.current.add(s.id));
    seenIdsRef.current.forEach((id) => { if (!currentIds.has(id)) seenIdsRef.current.delete(id); });

    setSelectedIds((prev) => {
      const valid = prev.filter((id) => currentIds.has(id));
      if (valid.length > 0) return valid.length === prev.length ? prev : valid;
      // Selection emptied — auto-pick: prefer non-background incoming, then any non-bg, then any.
      const candidate =
        incoming.find((s) => !s.background) ??
        sessions.find((s) => !s.background) ??
        sessions[0];
      return candidate ? [candidate.id] : [];
    });
  }, [sessions]);

  // Notify parent of selection changes so it can sync the session panel.
  useEffect(() => {
    onSelectionChange?.(selectedIds);
  }, [selectedIds, onSelectionChange]);

  const [showRecentlyDeleted, setShowRecentlyDeleted] = useState(false);

  // Focus management: auto-select a newly created session and focus its terminal once ready.
  const [pendingFocusSessionId, setPendingFocusSessionId] = useState<SessionId | null>(null);
  const [focusTrigger, setFocusTrigger] = useState(0);
  const prevStartingRef = useRef(new Set<string>());
  // Remember which pendingSelectSessionId we've already consumed so the
  // effect doesn't clobber the user's selection every time `sessions`
  // updates (which happens on every WebSocket event — roughly constantly).
  const lastHandledPendingRef = useRef<SessionId | null>(null);

  // When a new session is signalled, jump selection to it — once per id.
  useEffect(() => {
    if (!pendingSelectSessionId) {
      lastHandledPendingRef.current = null;
      return;
    }
    if (lastHandledPendingRef.current === pendingSelectSessionId) return;
    if (!sessions.some((s) => s.id === pendingSelectSessionId)) return;
    lastHandledPendingRef.current = pendingSelectSessionId;
    setSelectedIds([pendingSelectSessionId]);
    setPendingFocusSessionId(pendingSelectSessionId);
  }, [pendingSelectSessionId, sessions]);

  // When the pending session exits startingSessions (tmux ready), fire a focus pulse.
  useEffect(() => {
    const prev = prevStartingRef.current;
    const curr = startingSessions ?? new Set<string>();
    prevStartingRef.current = curr;
    if (pendingFocusSessionId && prev.has(pendingFocusSessionId) && !curr.has(pendingFocusSessionId)) {
      setFocusTrigger((t) => t + 1);
      setPendingFocusSessionId(null);
    }
  }, [startingSessions, pendingFocusSessionId]);

  const handleSelect = useCallback((id: SessionId, additive: boolean) => {
    // Manual selection cancels any in-flight auto-focus.  Without this a
    // session:ready event arriving after the user has already tabbed away
    // would steal focus back to the just-created session.
    setPendingFocusSessionId(null);
    setSelectedIds((prev) => {
      if (!additive) {
        return prev.length === 1 && prev[0] === id ? prev : [id];
      }
      if (prev.includes(id)) {
        // Deselect; ensure at least one remains if possible.
        const next = prev.filter((x) => x !== id);
        return next;
      }
      // Add; cap at 2, evict oldest when full.
      return prev.length >= 2 ? [prev[1], id] : [...prev, id];
    });
  }, []);

  const isMobile = useIsMobile();

  const selectedSessions = selectedIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is Session => s !== undefined);

  // A phone can't drive split-pane dividers (mouse-only) and can't fit two
  // terminals side-by-side. Collapse to the single active pane on mobile.
  const visibleSessions = isMobile ? selectedSessions.slice(0, 1) : selectedSessions;

  return (
    <div className="h-full flex flex-col">
      {showRecentlyDeleted && (
        <RecentlyDeletedPanel
          sessions={deletedSessions}
          onRestore={(id) => { onRestoreSession(id); setShowRecentlyDeleted(false); }}
          onPurge={(id) => { onPurgeSession(id); }}
          onClose={() => setShowRecentlyDeleted(false)}
        />
      )}

      {/* Terminal pane(s) */}
      <div className="flex-1 min-h-0 flex">
        {sessions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <p>No active sessions. Click "New Session" to start one.</p>
          </div>
        ) : visibleSessions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <p>Click a session below to open it.</p>
          </div>
        ) : (
          visibleSessions.map((session, i) => (
            <div
              key={session.id}
              className={`min-h-0 min-w-0 overflow-hidden flex flex-col flex-1 ${
                i > 0 ? 'border-l border-gray-800' : ''
              }`}
            >
              <TerminalPane
                trackId={trackId}
                session={session}
                todos={todos}
                onDestroy={() => onDestroySession(session.id)}
                onRename={(name) => onRenameSession(session.id, name)}
                defaultOpenPath={defaultOpenPath}
                autoFocus={i === 0}
                focusTrigger={i === 0 ? focusTrigger : undefined}
                issueBaseUrl={issueBaseUrl}
              />
            </div>
          ))
        )}
      </div>

      {/* Embedded office strip */}
      <TrackOfficeStrip
        sessions={sessions}
        selectedIds={selectedIds}
        trackName={trackName}
        onSelect={handleSelect}
        deletedCount={deletedSessions.length}
        onShowRecentlyDeleted={() => setShowRecentlyDeleted(true)}
        startingSessions={startingSessions}
      />
    </div>
  );
}
