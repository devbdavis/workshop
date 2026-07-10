import type { Session } from '@foundation/types';
import { providerColor } from '@ui/office/activity';
import { ActivityDot } from '@ui/shared/ActivityDot';

interface Props {
  session: Session;
  selected: boolean;
  onSelect: (id: Session['id']) => void;
}

export function SessionRow({ session, selected, onSelect }: Props) {
  const displayName = session.name || `session:${session.id.slice(0, 8)}`;
  const hasAttention = Boolean(session.attentionSince);

  return (
    <button
      onClick={() => onSelect(session.id)}
      className={`w-full flex items-center gap-2 text-left rounded-lg border px-2 py-1.5 transition-colors ${
        hasAttention ? 'border-amber-700/60 bg-amber-950/30' : 'border-gray-800 bg-gray-900 hover:border-gray-600'
      } ${selected ? 'ring-2 ring-blue-500/40 border-blue-500' : ''}`}
    >
      <ActivityDot activityStatus={session.activityStatus} className="shrink-0" />
      <span className="text-xs text-gray-200 truncate flex-1 min-w-0" title={displayName}>
        {displayName}
      </span>
      <span className={`text-[9px] px-1 py-0.5 rounded text-white/90 leading-none shrink-0 ${providerColor(session.provider)}`}>
        {session.provider}
      </span>
    </button>
  );
}
