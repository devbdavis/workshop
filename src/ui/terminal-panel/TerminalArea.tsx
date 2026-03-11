import type { Session } from '@foundation/types';
import { TerminalPanel } from './TerminalPanel';

interface Props {
  trackId: string;
  sessions: Session[];
  onDestroySession: (sessionId: string) => void;
}

export function TerminalArea({ trackId, sessions, onDestroySession }: Props) {
  const foregroundSessions = sessions.filter((s) => !s.background);
  const backgroundSessions = sessions.filter((s) => s.background);

  return (
    <div className="h-full flex flex-col">
      {backgroundSessions.length > 0 && (
        <BackgroundAgentBar sessions={backgroundSessions} onDestroy={onDestroySession} />
      )}

      {foregroundSessions.length === 0 ? (
        <div className="flex items-center justify-center flex-1 text-gray-500">
          <p>No active sessions. Click "New Session" to start one.</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {foregroundSessions.map((session) => (
            <div key={session.id} className="flex-1 min-h-0 flex flex-col border-b border-gray-800 last:border-b-0">
              <div className="flex items-center justify-between px-3 py-1 bg-gray-900 border-b border-gray-800 shrink-0">
                <span className="text-xs text-gray-400 font-mono">
                  session:{session.id.slice(0, 8)}
                </span>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${session.state === 'active' ? 'bg-green-500' : session.state === 'detached' ? 'bg-yellow-500' : 'bg-red-500'}`} />
                  <button
                    onClick={() => onDestroySession(session.id)}
                    className="text-xs text-gray-500 hover:text-red-400"
                  >
                    Kill
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <TerminalPanel trackId={trackId} sessionId={session.id} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BackgroundAgentBar({
  sessions,
  onDestroy,
}: {
  sessions: Session[];
  onDestroy: (sessionId: string) => void;
}) {
  return (
    <div className="px-3 py-1.5 bg-gray-900/80 border-b border-gray-800 flex items-center gap-3 shrink-0">
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span>{sessions.length} background agent{sessions.length > 1 ? 's' : ''}</span>
      </div>
      <div className="flex gap-2 ml-auto">
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-1.5 text-xs">
            <span className="text-gray-500 font-mono">{s.tmuxSession.slice(-8)}</span>
            <span className="text-gray-600">
              tmux attach -t {s.tmuxSession}
            </span>
            <button
              onClick={() => onDestroy(s.id)}
              className="text-gray-600 hover:text-red-400"
            >
              Kill
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
