import type { Session } from '@foundation/types';
import { TerminalPanel } from './TerminalPanel';

interface Props {
  trackId: string;
  sessions: Session[];
  onDestroySession: (sessionId: string) => void;
}

export function TerminalArea({ trackId, sessions, onDestroySession }: Props) {
  if (sessions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <p>No active sessions. Click "New Session" to start one.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {sessions.map((session) => (
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
  );
}
