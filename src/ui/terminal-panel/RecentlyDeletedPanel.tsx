import type { Session } from '@foundation/types';

interface Props {
  sessions: Session[];
  onRestore: (sessionId: string) => void;
  onPurge: (sessionId: string) => void;
  onClose: () => void;
}

/** Days remaining before a deleted session is permanently purged. */
function daysRemaining(deletedAt: string): number {
  const elapsed = Date.now() - new Date(deletedAt).getTime();
  const remaining = 7 - elapsed / (24 * 60 * 60 * 1_000);
  return Math.max(0, Math.ceil(remaining));
}

function formatDeletedDate(deletedAt: string): string {
  const date = new Date(deletedAt);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function RecentlyDeletedPanel({ sessions, onRestore, onPurge, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[480px] max-h-[600px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div>
            <h2 className="text-sm font-semibold text-gray-200">Recently Deleted</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">Sessions are permanently removed after 7 days.</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 text-lg leading-none px-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-600">
              <span className="text-3xl mb-3">🗑</span>
              <p className="text-sm">No recently deleted sessions.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-800">
              {sessions.map((session) => {
                const days = session.deletedAt ? daysRemaining(session.deletedAt) : 7;
                const displayName = session.name || `session:${session.id.slice(0, 8)}`;
                const deletedLabel = session.deletedAt ? formatDeletedDate(session.deletedAt) : '—';

                return (
                  <li key={session.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-200 truncate">{displayName}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        Deleted {deletedLabel}
                        <span className={`ml-2 ${days <= 1 ? 'text-red-400' : 'text-gray-600'}`}>
                          · {days}d remaining
                        </span>
                        {session.worktreeRoot && (
                          <span className="ml-2 text-blue-700">· worktree</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => onRestore(session.id)}
                        className="text-[11px] px-2 py-1 rounded bg-blue-900/50 hover:bg-blue-800 text-blue-300 transition-colors"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => onPurge(session.id)}
                        className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-red-900/50 text-gray-500 hover:text-red-400 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
