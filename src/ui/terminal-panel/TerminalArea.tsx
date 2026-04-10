import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session, SessionId } from '@foundation/types';
import { TerminalPanel } from './TerminalPanel';
import { TrackOfficeStrip } from './TrackOfficeStrip';
import { RecentlyDeletedPanel } from './RecentlyDeletedPanel';

interface Props {
  trackId: string;
  trackName: string;
  sessions: Session[];
  deletedSessions: Session[];
  startingSessions?: Set<string>;
  onDestroySession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  onRestoreSession: (sessionId: string) => void;
  onPurgeSession: (sessionId: string) => void;
  defaultOpenPath?: string;
}

const storageKey = (trackId: string) => `workshop:selected:${trackId}`;

export function TerminalArea({ trackId, trackName, sessions, deletedSessions, startingSessions, onDestroySession, onRenameSession, onRestoreSession, onPurgeSession, defaultOpenPath }: Props) {
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

  const [showRecentlyDeleted, setShowRecentlyDeleted] = useState(false);

  const handleSelect = useCallback((id: SessionId, additive: boolean) => {
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

  const selectedSessions = selectedIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is Session => s !== undefined);

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
        ) : selectedSessions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <p>Click a session below to open it.</p>
          </div>
        ) : (
          selectedSessions.map((session, i) => (
            <div
              key={session.id}
              className={`min-h-0 min-w-0 overflow-hidden flex flex-col flex-1 ${
                i > 0 ? 'border-l border-gray-800' : ''
              }`}
            >
              <TerminalPane
                trackId={trackId}
                session={session}
                onDestroy={() => onDestroySession(session.id)}
                onRename={(name) => onRenameSession(session.id, name)}
                defaultOpenPath={defaultOpenPath}
                autoFocus={i === 0}
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

// --- Terminal Pane ---

interface PaneProps {
  trackId: string;
  session: Session;
  onDestroy: () => void;
  onRename: (name: string) => void;
  defaultOpenPath?: string;
  autoFocus: boolean;
}

function TerminalPane({ trackId, session, onDestroy, onRename, defaultOpenPath, autoFocus }: PaneProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const displayName = session.name || `session:${session.id.slice(0, 8)}`;
  const editorPath = session.worktreeRoot ?? defaultOpenPath;
  const terminalPath = session.workingDirectory ?? editorPath;

  const startEditing = useCallback(() => {
    setEditValue(session.name || '');
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [session.name]);

  const commitEdit = useCallback(() => {
    onRename(editValue.trim());
    setEditing(false);
  }, [editValue, onRename]);

  const statusColor =
    session.activityStatus === 'needs-input' ? 'bg-red-500' :
    session.activityStatus === 'working' ? 'bg-green-500' :
    session.activityStatus === 'idle' ? 'bg-yellow-500' :
    'bg-gray-600';

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between px-2 py-0.5 bg-gray-900 border-b border-gray-800 shrink-0">
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="text-xs text-gray-300 font-mono bg-gray-800 border border-gray-600 rounded px-1 py-0 outline-none focus:border-blue-500 w-40"
          />
        ) : (
          <span
            className="text-xs text-gray-400 font-mono truncate cursor-pointer hover:text-gray-200 flex items-center gap-1.5"
            onDoubleClick={startEditing}
            title="Double-click to rename"
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`} />
            {displayName}
          </span>
        )}
        <div className="flex items-center gap-1">
          {editorPath && (
            <>
              <button
                onClick={() => fetch('/api/shell/open-in-editor', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ path: editorPath, sessionId: session.id }),
                })}
                className="flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-blue-400 px-1"
                title={`Open in Cursor: ${editorPath}`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                <span>Cursor</span>
              </button>
              <button
                onClick={() => fetch('/api/shell/open-in-editor', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ path: terminalPath, app: 'terminal' }),
                })}
                className="text-[10px] text-gray-500 hover:text-green-400 px-1 font-mono"
                title={`Open in iTerm: ${terminalPath}`}
              >
                &gt;_
              </button>
            </>
          )}
          <button
            onClick={onDestroy}
            className="text-xs text-gray-500 hover:text-red-400 px-1"
            title="Destroy session"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <TerminalPanel trackId={trackId} sessionId={session.id} autoFocus={autoFocus} />
      </div>
    </div>
  );
}
