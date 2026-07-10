import { Link } from 'react-router-dom';
import type { SessionId } from '@foundation/types';
import type { TrackSessionGroup } from './group-sessions';
import { SessionRow } from './SessionRow';

interface Props {
  groups: TrackSessionGroup[];
  selectedIds: SessionId[];
  onSelect: (id: SessionId, additive: boolean) => void;
  onNewSession: (trackId: string) => void;
}

export function TrackNavigator({ groups, selectedIds, onSelect, onNewSession }: Props) {
  if (groups.length === 0) {
    return (
      <div className="px-3 py-3">
        <p className="text-xs text-gray-600 italic">No active sessions.</p>
      </div>
    );
  }

  return (
    <div className="px-3 py-3 space-y-3">
      {groups.map(({ track, sessions }) => (
        <div key={track.id}>
          <div className="flex items-center justify-between">
            <Link
              to={`/tracks/${track.id}`}
              className="text-xs font-medium text-gray-400 hover:text-blue-300 transition-colors truncate"
            >
              {track.name}
            </Link>
            <button
              onClick={() => onNewSession(track.id)}
              className="text-gray-600 hover:text-blue-400 px-1 leading-none shrink-0"
              title="New session"
            >
              +
            </button>
          </div>
          <div className="flex flex-col gap-1 pt-1.5">
            {sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                selected={selectedIds.includes(session.id)}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
