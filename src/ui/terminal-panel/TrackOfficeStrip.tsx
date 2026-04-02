import { useState } from 'react';
import type { Session, SessionId } from '@foundation/types';
import { CharacterSvg } from '@ui/office/CharacterSvg';
import { getActivityState, providerColor } from '@ui/office/activity';

const COLLAPSED_KEY = 'workshop:sessions-strip-collapsed';

interface Props {
  sessions: Session[];
  selectedIds: SessionId[];
  trackName: string;
  onSelect: (id: SessionId, additive: boolean) => void;
}

/**
 * Compact horizontal strip of session desk units embedded in the track view.
 * Click to select a session; ⌘-click to add a second for side-by-side view.
 * Collapse button in the header reclaims vertical space when not needed.
 */
export function TrackOfficeStrip({ sessions, selectedIds, onSelect }: Props) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === 'true'; } catch { return false; }
  });

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSED_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div className="shrink-0 border-t border-gray-800 bg-gray-950">
      <div className="flex items-center gap-2 px-3 py-1">
        <button
          onClick={toggle}
          className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
          title={collapsed ? 'Show sessions' : 'Hide sessions'}
        >
          <svg
            className={`w-3 h-3 transition-transform ${collapsed ? '-rotate-90' : ''}`}
            viewBox="0 0 12 12"
            fill="currentColor"
          >
            <path d="M3 5l3 3 3-3H3z" />
          </svg>
          <span className="uppercase tracking-wider">Sessions</span>
          <span className="text-gray-700 ml-0.5">({sessions.length})</span>
        </button>
        {!collapsed && (
          <span className="text-[10px] text-gray-700">· click to focus · ⌘-click for split</span>
        )}
      </div>

      {!collapsed && sessions.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-2 pb-2" style={{ height: '152px' }}>
          {sessions.map((session) => (
            <div
              key={session.id}
              className="shrink-0 w-[90px] h-full cursor-pointer"
              onClick={(e) => onSelect(session.id, e.metaKey)}
            >
              <TrackDeskUnit session={session} selected={selectedIds.includes(session.id)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Bespoke desk card for the strip ---
// Uses CharacterSvg directly; no tooltip (names are visible inline).

interface DeskProps {
  session: Session;
  selected: boolean;
}

function TrackDeskUnit({ session, selected }: DeskProps) {
  const activityState = getActivityState(session);
  const displayName = session.name || `session:${session.id.slice(0, 8)}`;

  const statusColor =
    session.activityStatus === 'needs-input' ? 'bg-red-500' :
    session.activityStatus === 'working' ? 'bg-green-500' :
    session.activityStatus === 'idle' ? 'bg-yellow-500' :
    'bg-gray-600';

  return (
    <div
      className={`relative bg-gray-900 border rounded-lg p-2 h-full flex flex-col
        ${selected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-gray-800 hover:border-gray-600'}
        transition-colors`}
    >
      <span
        className={`absolute top-1.5 right-1.5 text-[8px] px-1 py-0.5 rounded text-white/90 leading-none ${providerColor(session.provider)}`}
      >
        {session.provider}
      </span>

      {/* Fixed-height character area so desks stay horizontally aligned */}
      <div className="flex items-end justify-center overflow-hidden" style={{ height: '72px' }}>
        <CharacterSvg sessionId={session.id} activityState={activityState} className="w-full" />
      </div>

      {/* Fixed-height name area: 2 lines at text-[10px] leading-tight ≈ 28px */}
      <div className="mt-1 flex items-start gap-1" style={{ height: '28px' }}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-[3px] ${statusColor}`} />
        <span className="text-[10px] text-gray-200 leading-tight break-words min-w-0 line-clamp-2">
          {displayName}
        </span>
      </div>
    </div>
  );
}
