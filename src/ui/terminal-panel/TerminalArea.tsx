import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session, SessionId, Todo } from '@foundation/types';
import { TerminalPanel } from './TerminalPanel';
import { TrackOfficeStrip } from './TrackOfficeStrip';
import { ActivityDot } from '@ui/shared/ActivityDot';
import { RecentlyDeletedPanel } from './RecentlyDeletedPanel';
import { SessionLinkButtons } from './SessionLinkButtons';
import { TerminalModal } from '../track-view/TerminalModal';
import { useLaunchApps, editorLabel, terminalLabel } from '@ui/hooks/useLaunchApps';
import { useEditorLaunch } from '@ui/hooks/useEditorLaunch';

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
  /** Create an undocked shell session at `cwd` — opened in the floating terminal modal. */
  onOpenShell?: (cwd: string, name: string) => Promise<Session | null>;
}

const storageKey = (trackId: string) => `workshop:selected:${trackId}`;

/** `/repos/workshop/src` → `src`. Used to name shell sessions after their folder. */
function basename(p: string): string {
  return p.replace(/\/+$/, '').split('/').pop() || p;
}

export function TerminalArea({ trackId, trackName, sessions, todos, deletedSessions, startingSessions, pendingSelectSessionId, onDestroySession, onRenameSession, onRestoreSession, onPurgeSession, defaultOpenPath, onSelectionChange, issueBaseUrl, onOpenShell }: Props) {
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

  // A terminal opened from a pane header lives in a floating modal until docked.
  // It is a real session all along, so it also shows up in the office strip.
  const [shellModal, setShellModal] = useState<{ sessionId: SessionId; title: string } | null>(null);

  // cwd → the shell session we opened for it. Without this, every click of the
  // terminal button spawns another tmux session that nobody ever reaps.
  const shellSessionsRef = useRef(new Map<string, SessionId>());

  const openShellTerminal = useCallback(
    async (cwd: string) => {
      if (!onOpenShell) return;
      const existing = shellSessionsRef.current.get(cwd);
      if (existing && sessions.some((s) => s.id === existing)) {
        setShellModal({ sessionId: existing, title: cwd });
        return;
      }
      shellSessionsRef.current.delete(cwd);
      const session = await onOpenShell(cwd, `Shell: ${basename(cwd)}`);
      if (session) {
        shellSessionsRef.current.set(cwd, session.id);
        setShellModal({ sessionId: session.id, title: cwd });
      }
    },
    [onOpenShell, sessions],
  );

  const dockShellTerminal = useCallback(() => {
    if (!shellModal) return;
    const id = shellModal.sessionId;
    // Same two-pane cap as additive click-selection in the office strip.
    setSelectedIds((prev) => (prev.includes(id) ? prev : prev.length >= 2 ? [prev[1], id] : [...prev, id]));
    setShellModal(null);
  }, [shellModal]);

  const selectedSessions = selectedIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is Session => s !== undefined);

  return (
    <div className="h-full flex flex-col">
      {shellModal && (
        <TerminalModal
          trackId={trackId}
          sessionId={shellModal.sessionId}
          title={shellModal.title}
          onClose={() => setShellModal(null)}
          onDock={dockShellTerminal}
        />
      )}

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
                todos={todos}
                onDestroy={() => onDestroySession(session.id)}
                onRename={(name) => onRenameSession(session.id, name)}
                defaultOpenPath={defaultOpenPath}
                autoFocus={i === 0}
                focusTrigger={i === 0 ? focusTrigger : undefined}
                issueBaseUrl={issueBaseUrl}
                onOpenTerminal={onOpenShell ? openShellTerminal : undefined}
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
  todos: Todo[];
  onDestroy: () => void;
  onRename: (name: string) => void;
  defaultOpenPath?: string;
  autoFocus: boolean;
  focusTrigger?: number;
  issueBaseUrl?: string;
  onOpenTerminal?: (cwd: string) => void;
}

function TerminalPane({ trackId, session, todos, onDestroy, onRename, defaultOpenPath, autoFocus, focusTrigger, issueBaseUrl, onOpenTerminal }: PaneProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const launchApps = useLaunchApps();
  const editor = useEditorLaunch();
  const editorName = editor.uriPrefix ? 'Editor' : editorLabel(launchApps);

  const displayName = session.name || `session:${session.id.slice(0, 8)}`;
  const editorPath = session.worktreeRoot ?? defaultOpenPath;
  const terminalPath = session.workingDirectory ?? editorPath;
  const linkedTodo = todos.find((t) => t.sessionId === session.id);

  const startEditing = useCallback(() => {
    setEditValue(session.name || '');
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [session.name]);

  const commitEdit = useCallback(() => {
    onRename(editValue.trim());
    setEditing(false);
  }, [editValue, onRename]);

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
            <ActivityDot activityStatus={session.activityStatus} className="shrink-0" />
            {displayName}
          </span>
        )}
        <div className="flex items-center gap-1">
          <SessionLinkButtons
            pullRequests={linkedTodo?.pullRequests}
            issueKey={linkedTodo?.issueKey}
            issueBaseUrl={issueBaseUrl}
          />
          {editorPath && (
            <>
              <button
                onClick={() => editor.openInEditor(editorPath, session.id)}
                className="flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-blue-400 px-1"
                title={`Open in ${editorName}: ${editorPath}`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                <span>{editorName}</span>
              </button>
            </>
          )}
          {/* Native install (a host terminal is detected and no remote editor
              URI prefix is configured) → open the local terminal emulator, as it
              worked before the in-app shell landed. Otherwise (Docker / remote
              host) fall back to the in-app dockable shell, which runs inside the
              container. Gated on terminalPath, not editorPath: a session can have
              a working directory without the track exposing an editor root. */}
          {terminalPath && launchApps?.resolvedTerminal && !editor.uriPrefix ? (
            <button
              onClick={() => fetch('/api/shell/open-in-editor', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: terminalPath, app: 'terminal', sessionId: session.id }),
              })}
              className="text-[10px] text-gray-500 hover:text-green-400 px-1 font-mono"
              title={`Open in ${terminalLabel(launchApps)}: ${terminalPath}`}
            >
              &gt;_
            </button>
          ) : onOpenTerminal && terminalPath ? (
            <button
              onClick={() => onOpenTerminal(terminalPath)}
              className="text-[10px] text-gray-500 hover:text-green-400 px-1 font-mono"
              title={`Open a terminal in: ${terminalPath}`}
            >
              &gt;_
            </button>
          ) : null}
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
        <TerminalPanel trackId={trackId} sessionId={session.id} autoFocus={autoFocus} focusTrigger={focusTrigger} />
      </div>
    </div>
  );
}
