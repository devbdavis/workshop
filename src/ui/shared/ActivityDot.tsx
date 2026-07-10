import type { Session } from '@foundation/types';

/** Shared red/green/yellow/gray dot color mapping — was duplicated across TerminalArea, TrackOfficeStrip, and Dashboard. */
function activityDotColor(activityStatus?: Session['activityStatus']): string {
  if (activityStatus === 'needs-input') return 'bg-red-500';
  if (activityStatus === 'working') return 'bg-green-500';
  if (activityStatus === 'idle') return 'bg-yellow-500';
  return 'bg-gray-600';
}

interface Props {
  activityStatus?: Session['activityStatus'];
  className?: string;
}

export function ActivityDot({ activityStatus, className = '' }: Props) {
  return <span className={`w-1.5 h-1.5 rounded-full ${activityDotColor(activityStatus)} ${className}`} />;
}
