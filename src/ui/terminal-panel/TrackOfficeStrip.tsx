import type { Session, SessionId } from '@foundation/types';
import { OfficeDeskUnit } from '@ui/office/OfficeDeskUnit';
import { getActivityState } from '@ui/office/activity';

interface Props {
  sessions: Session[];
  selectedIds: SessionId[];
  trackName: string;
  onSelect: (id: SessionId, additive: boolean) => void;
}

/**
 * Compact horizontal strip of session desk units embedded in the track view.
 * Click to select a session; ⌘-click to add a second for side-by-side view.
 */
export function TrackOfficeStrip({ sessions, selectedIds, trackName, onSelect }: Props) {
  if (sessions.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-gray-800 bg-gray-950">
      <div className="flex items-center gap-2 px-3 py-1 border-b border-gray-800/60">
        <span className="text-[10px] text-gray-600 uppercase tracking-wider">Sessions</span>
        <span className="text-[10px] text-gray-700">· click to focus · ⌘-click for split</span>
      </div>
      <div className="flex gap-2 overflow-x-auto px-2 py-2" style={{ height: '148px' }}>
        {sessions.map((session) => (
          <div
            key={session.id}
            className="shrink-0 w-[88px] h-full cursor-pointer"
            // Parent div handles selection so we get access to e.metaKey;
            // OfficeDeskUnit's onAttach is a no-op here.
            onClick={(e) => onSelect(session.id, e.metaKey)}
          >
            <OfficeDeskUnit
              session={session}
              activityState={getActivityState(session)}
              trackName={trackName}
              spriteUrl={null}
              selected={selectedIds.includes(session.id)}
              onAttach={() => {}}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
