import type { Session } from '@foundation/types';

export type ActivityState = 'working' | 'sleeping' | 'floor-sleeping' | 'dying' | 'empty';

/** Derive visual state from session data */
export function getActivityState(session: Session & { dying?: boolean }): ActivityState {
  if (session.dying) return 'dying';
  if (session.state === 'dead') return 'empty';
  if (session.state === 'suspended') return 'floor-sleeping';

  // Trust the real-time activity status when available — avoids the office
  // showing 'sleeping' while the orb is green (e.g. long tool calls where
  // pane content is stable and lastActivityAt goes stale).
  if (session.activityStatus === 'working' || session.activityStatus === 'needs-input') return 'working';
  if (session.activityStatus === 'idle') return 'sleeping';

  // Fallback for sessions not yet through a sync cycle
  if (!session.lastActivityAt) return 'working';
  const idleMs = Date.now() - new Date(session.lastActivityAt).getTime();
  return idleMs > 60_000 ? 'sleeping' : 'working';
}

/** Human-readable idle duration */
export function getIdleDuration(session: Session): string {
  if (!session.lastActivityAt) return '';
  const ms = Date.now() - new Date(session.lastActivityAt).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3600_000)}h`;
}

/** Provider badge color */
export function providerColor(provider: string): string {
  switch (provider) {
    case 'claude': return 'bg-blue-500';
    case 'codex': return 'bg-red-500';
    case 'gemini': return 'bg-yellow-500';
    default: return 'bg-gray-500';
  }
}
