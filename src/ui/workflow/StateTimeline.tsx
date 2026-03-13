import { WorkflowStateIndicator } from './WorkflowStateIndicator';

interface TransitionEntry {
  id: string;
  fromState: string;
  toState: string;
  actor: { type: string; agentId?: string; userId?: string; reason?: string };
  comment?: string;
  createdAt: string;
}

interface Props {
  transitions: TransitionEntry[];
  ticketType: 'epic' | 'task';
}

function getDotColor(actorType: string): string {
  switch (actorType) {
    case 'agent':
      return 'bg-blue-400';
    case 'human':
      return 'bg-amber-400';
    default:
      return 'bg-gray-500';
  }
}

function formatActorLabel(actor: TransitionEntry['actor']): string {
  switch (actor.type) {
    case 'agent':
      return actor.agentId ? `Agent ${actor.agentId.slice(0, 8)}` : 'Agent';
    case 'human':
      return actor.userId ?? 'Human';
    case 'system':
      return actor.reason ?? 'System';
    default:
      return actor.type;
  }
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function StateTimeline({ transitions, ticketType }: Props) {
  // Most recent first
  const sorted = [...transitions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  if (sorted.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic py-2">No transitions yet.</div>
    );
  }

  return (
    <div className="relative">
      {sorted.map((t, idx) => {
        const isLast = idx === sorted.length - 1;
        const dotColor = getDotColor(t.actor.type);

        return (
          <div key={t.id} className="relative flex gap-3 pb-4">
            {/* Vertical line + dot */}
            <div className="flex flex-col items-center shrink-0 w-4">
              <div className={`w-2.5 h-2.5 rounded-full ${dotColor} shrink-0 mt-0.5`} />
              {!isLast && (
                <div className="w-px flex-1 bg-gray-700 mt-1" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <WorkflowStateIndicator state={t.fromState} ticketType={ticketType} size="sm" />
                <span className="text-[10px] text-gray-500">&rarr;</span>
                <WorkflowStateIndicator state={t.toState} ticketType={ticketType} size="sm" />
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-gray-500">
                  {formatActorLabel(t.actor)}
                </span>
                <span className="text-[10px] text-gray-600">
                  {formatTimestamp(t.createdAt)}
                </span>
              </div>
              {t.comment && (
                <p className="text-[11px] text-gray-400 mt-1 italic">
                  {t.comment}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
