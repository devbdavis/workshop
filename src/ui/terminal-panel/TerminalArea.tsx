import { useState, useEffect, useRef } from 'react';
import type { Session, SessionId } from '@foundation/types';
import { SplitPaneLayout } from './SplitPaneLayout';
import { useTerminalLayout } from './use-terminal-layout';

interface Props {
  trackId: string;
  sessions: Session[];
  onDestroySession: (sessionId: string) => void;
  onCreateSession: () => Promise<Session | null>;
  onRenameSession: (sessionId: string, name: string) => void;
}

export function TerminalArea({ trackId, sessions, onDestroySession, onCreateSession, onRenameSession }: Props) {
  const [minimizedIds, setMinimizedIds] = useState<Set<SessionId>>(() =>
    new Set(sessions.filter((s) => s.background).map((s) => s.id)),
  );

  // Auto-minimize newly arriving background sessions
  const seenIdsRef = useRef<Set<SessionId>>(new Set(sessions.map((s) => s.id)));
  useEffect(() => {
    const incoming = sessions.filter((s) => !seenIdsRef.current.has(s.id));
    if (incoming.length > 0) {
      const newBackground = incoming.filter((s) => s.background);
      if (newBackground.length > 0) {
        setMinimizedIds((prev) => {
          const next = new Set(prev);
          newBackground.forEach((s) => next.add(s.id));
          return next;
        });
      }
      incoming.forEach((s) => seenIdsRef.current.add(s.id));
    }
    // Clean up removed sessions
    const currentIds = new Set(sessions.map((s) => s.id));
    seenIdsRef.current.forEach((id) => {
      if (!currentIds.has(id)) seenIdsRef.current.delete(id);
    });
  }, [sessions]);

  const minimize = (id: SessionId) =>
    setMinimizedIds((prev) => { const n = new Set(prev); n.add(id); return n; });

  const restore = (id: SessionId) =>
    setMinimizedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });

  const visibleSessions = sessions.filter((s) => !minimizedIds.has(s.id));
  const minimizedSessions = sessions.filter((s) => minimizedIds.has(s.id));

  const { layout, splitPane, closePane, resizePanes } = useTerminalLayout(trackId, visibleSessions);

  return (
    <div className="h-full flex flex-col">
      {/* Main terminal area */}
      {!layout.root || visibleSessions.length === 0 ? (
        <div className="flex items-center justify-center flex-1 text-gray-500">
          <p>No active sessions. Click "New Session" to start one.</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <SplitPaneLayout
            node={layout.root}
            trackId={trackId}
            sessions={visibleSessions}
            onSplit={splitPane}
            onClose={closePane}
            onResize={resizePanes}
            onCreateSession={onCreateSession}
            onDestroySession={onDestroySession}
            onRenameSession={onRenameSession}
            onMinimize={minimize}
          />
        </div>
      )}

      {/* Minimized session tray */}
      {minimizedSessions.length > 0 && (
        <div className="shrink-0 px-3 py-1.5 bg-gray-900/80 border-t border-gray-800 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-gray-600 uppercase tracking-wider mr-1">Minimized</span>
          {minimizedSessions.map((s) => (
            <MinimizedChip
              key={s.id}
              session={s}
              onRestore={() => restore(s.id)}
              onDestroy={() => { onDestroySession(s.id); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MinimizedChip({
  session,
  onRestore,
  onDestroy,
}: {
  session: Session;
  onRestore: () => void;
  onDestroy: () => void;
}) {
  const stateColor =
    session.state === 'active' ? 'bg-green-500' :
    session.state === 'detached' ? 'bg-yellow-500' : 'bg-red-500';

  const displayName = session.name || session.tmuxSession.slice(-8);

  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-xs group">
      <span className={`w-1.5 h-1.5 rounded-full ${stateColor} shrink-0`} />
      <button
        onClick={onRestore}
        className="text-gray-300 hover:text-white font-mono truncate max-w-[160px]"
        title="Restore session"
      >
        {displayName}
      </button>
      <button
        onClick={onDestroy}
        className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 ml-0.5"
        title="Kill session"
      >
        ✕
      </button>
    </div>
  );
}
