import { useState } from 'react';
import type { Session } from '@foundation/types';
import type { ActivityState } from './activity';
import { providerColor, getIdleDuration } from './activity';
import { CharacterSvg } from './CharacterSvg';
import { SpeechBubble } from './SpeechBubble';

type ActivityStatus = Session['activityStatus'];

function statusDotColor(status: ActivityStatus): string {
  if (status === 'needs-input') return 'bg-red-500';
  if (status === 'working') return 'bg-green-500';
  if (status === 'idle') return 'bg-yellow-500';
  return 'bg-gray-600';
}

function statusLabel(status: ActivityStatus): string {
  if (status === 'needs-input') return 'Waiting for input';
  if (status === 'working') return 'Working';
  if (status === 'idle') return 'Idle';
  return 'Unknown';
}

function StatusDot({ activityStatus }: { activityStatus: ActivityStatus }) {
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotColor(activityStatus)}`}
      title={statusLabel(activityStatus)}
    />
  );
}

interface Props {
  session: Session & { dying?: boolean };
  activityState: ActivityState;
  trackName: string;
  spriteUrl: string | null;
  onAttach: () => void;
  selected?: boolean;
}

/**
 * Individual desk card in the office grid.
 * Shows character, name plate, provider badge, and state-dependent overlays.
 */
export function OfficeDeskUnit({ session, activityState, trackName, spriteUrl, onAttach, selected }: Props) {
  const [showTooltip, setShowTooltip] = useState(false);
  const displayName = session.name || `session:${session.id.slice(0, 8)}`;
  const isActive = activityState === 'working' || activityState === 'sleeping';
  const isDying = activityState === 'dying';
  const isSleepy = activityState === 'sleeping' || activityState === 'floor-sleeping';
  const clickable = isActive && !isDying;

  return (
    <div
      className={`office-desk-unit relative bg-gray-900 border rounded-lg p-3
        ${selected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-gray-800'}
        ${isDying ? 'office-char-dying' : ''}
        ${clickable ? 'cursor-pointer hover:border-gray-600' : 'cursor-default'}
        transition-colors`}
      onClick={clickable ? onAttach : undefined}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Provider badge (top-right) */}
      <span
        className={`absolute top-2 right-2 text-[9px] px-1.5 py-0.5 rounded text-white/90 ${providerColor(session.provider)}`}
      >
        {session.provider}
      </span>

      {/* Background badge */}
      {session.background && (
        <span className="absolute top-2 left-2 text-[9px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-400">
          bg
        </span>
      )}

      {/* Character image */}
      <div className="w-full aspect-square flex items-center justify-center mb-2 relative">
        {spriteUrl ? (
          <img
            src={spriteUrl}
            alt={displayName}
            className={`w-full h-full object-contain office-char-${activityState}`}
          />
        ) : (
          <CharacterSvg
            sessionId={session.id}
            activityState={activityState}
            className="w-full h-full"
          />
        )}

        {/* Dying speech bubble */}
        {isDying && <SpeechBubble text="I'm dying..." />}
      </div>

      {/* Idle duration for sleeping states */}
      {isSleepy && session.lastActivityAt && (
        <div className="text-center text-[10px] text-gray-500 mb-1">
          idle {getIdleDuration(session)}
        </div>
      )}

      {/* Name plate */}
      <div className="text-center truncate">
        <div className="flex items-center justify-center gap-1.5 mb-0.5">
          <StatusDot activityStatus={session.activityStatus} />
          <span className="text-xs text-gray-200 font-medium truncate">{displayName}</span>
        </div>
        <div className="text-[10px] text-gray-500 truncate">{trackName}</div>
      </div>

      {/* Hover tooltip */}
      {showTooltip && !isDying && (
        <div
          className="absolute z-50 left-1/2 -translate-x-1/2 top-full mt-2
                     bg-gray-800 border border-gray-700 rounded-lg px-3 py-2
                     text-[11px] text-gray-300 whitespace-nowrap shadow-lg"
        >
          <div className="font-medium text-gray-100 mb-1">{displayName}</div>
          <div>Track: {trackName}</div>
          <div>Provider: {session.provider}</div>
          <div>Status: {statusLabel(session.activityStatus)}{session.background ? ' (background)' : ''}</div>
          {session.lastActivityAt && (
            <div>Last active: {new Date(session.lastActivityAt).toLocaleTimeString()}</div>
          )}
          <div>Created: {new Date(session.createdAt).toLocaleString()}</div>
        </div>
      )}
    </div>
  );
}
