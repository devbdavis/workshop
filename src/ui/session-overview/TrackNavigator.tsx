import { Link } from 'react-router-dom';
import type { SessionId } from '@foundation/types';
import type { TrackSessionGroup } from './group-sessions';
import { SessionRow } from './SessionRow';

interface Props {
  groups: TrackSessionGroup[];
  selectedId: SessionId | null;
  onSelect: (id: SessionId) => void;
}

export function TrackNavigator({ groups, selectedId, onSelect }: Props) {
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
          <Link
            to={`/tracks/${track.id}`}
            className="text-xs font-medium text-gray-400 hover:text-blue-300 transition-colors truncate"
          >
            {track.name}
          </Link>
          <div className="flex flex-col gap-1 pt-1.5">
            {sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                selected={session.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
