import { useState } from 'react';
import type { Session, Todo } from '@foundation/types';

interface Props {
  sessions: Session[];
  todos: Todo[];
  onOpenTodo: (todo: Todo) => void;
}

const PROVIDER_COLORS: Record<string, string> = {
  claude: 'bg-orange-400',
  codex: 'bg-emerald-400',
  gemini: 'bg-blue-400',
  cursor: 'bg-violet-400',
};

function StateIndicator({
  state,
  activityStatus,
}: {
  state: Session['state'];
  activityStatus?: Session['activityStatus'];
}) {
  if (activityStatus === 'working') {
    return <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />;
  }
  if (activityStatus === 'needs-input') {
    return <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse shrink-0" />;
  }
  if (state === 'active') return <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />;
  if (state === 'detached') return <span className="w-2 h-2 rounded-full bg-gray-400 shrink-0" />;
  if (state === 'dead') return <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />;
  return <span className="w-2 h-2 rounded-full bg-gray-600 shrink-0" />;
}

function statusActivityLabel(state: Session['state'], activityStatus?: Session['activityStatus']): string {
  if (activityStatus === 'working') return 'Working';
  if (activityStatus === 'needs-input') return 'Waiting';
  if (activityStatus === 'idle') return 'Idle';
  if (state === 'active') return 'Active';
  if (state === 'detached') return 'Detached';
  if (state === 'dead') return 'Dead';
  if (state === 'suspended') return 'Suspended';
  return state;
}

function TodoStatusBadge({ status }: { status: Todo['status'] }) {
  const config: Record<string, { label: string; className: string }> = {
    backlog: { label: 'Backlog', className: 'text-gray-400 bg-gray-800' },
    ready: { label: 'Ready', className: 'text-blue-400 bg-blue-900/40' },
    'in-progress': { label: 'Active', className: 'text-amber-400 bg-amber-900/40' },
    review: { label: 'Review', className: 'text-purple-400 bg-purple-900/40' },
    done: { label: 'Done', className: 'text-green-400 bg-green-900/40' },
  };
  const { label, className } = config[status] ?? { label: status, className: 'text-gray-400 bg-gray-800' };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${className}`}>{label}</span>;
}

function SessionCard({
  session,
  todo,
  onOpenTodo,
}: {
  session: Session;
  todo: Todo | null;
  onOpenTodo: (todo: Todo) => void;
}) {
  const providerLabel = session.provider.charAt(0).toUpperCase() + session.provider.slice(1);
  const providerColor = PROVIDER_COLORS[session.provider] ?? 'bg-gray-400';

  return (
    <div className="p-4 space-y-3">
      {/* Session header */}
      <div className="flex items-center gap-2 min-w-0">
        <StateIndicator state={session.state} activityStatus={session.activityStatus} />
        <span className="text-sm font-medium text-gray-200 flex-1 min-w-0 truncate">
          {session.name ?? `Session ${session.id.slice(0, 8)}`}
        </span>
        <span className="text-[10px] text-gray-500 shrink-0">
          {statusActivityLabel(session.state, session.activityStatus)}
        </span>
        <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 shrink-0`}>
          <span className={`w-1.5 h-1.5 rounded-full ${providerColor}`} />
          {providerLabel}
        </span>
      </div>

      {/* Linked todo */}
      {todo !== null ? (
        <div className="rounded-lg border border-gray-700 bg-gray-800/40">
          <div className="p-3 space-y-3">
            {/* Todo title + status */}
            <div className="flex items-start justify-between gap-2">
              <button
                onClick={() => onOpenTodo(todo)}
                className="text-sm text-gray-200 hover:text-blue-300 text-left font-medium leading-snug transition-colors"
              >
                {todo.title}
              </button>
              <TodoStatusBadge status={todo.status} />
            </div>

            {/* Meta: ticket + PRs */}
            <div className="space-y-2">
              {todo.issueKey && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wide w-10 shrink-0">Issue</span>
                  <span className="text-xs font-mono text-blue-400 bg-blue-900/30 px-2 py-0.5 rounded">
                    {todo.issueKey}
                  </span>
                </div>
              )}

              {todo.pullRequests !== undefined && todo.pullRequests.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wide w-10 shrink-0 pt-0.5">
                    PRs
                  </span>
                  <div className="space-y-1 flex-1 min-w-0">
                    {todo.pullRequests.map((pr, i) => (
                      <a
                        key={i}
                        href={pr.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-blue-400 hover:text-blue-300 hover:underline truncate"
                        title={pr.url}
                      >
                        {pr.title ?? pr.url}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {todo.resolution && (todo.status === 'review' || todo.status === 'done') && (
                <div className="flex items-start gap-2">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wide w-10 shrink-0 pt-0.5">
                    Note
                  </span>
                  <p className="text-xs text-gray-400 leading-relaxed line-clamp-3 flex-1">
                    {todo.resolution}
                  </p>
                </div>
              )}
            </div>

            <button
              onClick={() => onOpenTodo(todo)}
              className="w-full text-xs text-center text-gray-500 hover:text-gray-300 py-1.5 border border-gray-700 hover:border-gray-600 rounded transition-colors"
            >
              Open Todo →
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-800 p-3">
          <p className="text-xs text-gray-600 italic">No todo linked to this session.</p>
        </div>
      )}
    </div>
  );
}

export function SessionPanel({ sessions, todos, onOpenTodo }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);

  if (sessions.length === 0) {
    return (
      <div className="p-4">
        <p className="text-xs text-gray-600 italic">
          No active sessions. Use "New Session" above to start one, or dispatch a todo.
        </p>
      </div>
    );
  }

  const clampedIdx = Math.min(activeIdx, sessions.length - 1);
  const session = sessions[clampedIdx];
  const linkedTodo = todos.find((t) => t.sessionId === session.id) ?? null;

  return (
    <div>
      {/* Multi-session selector — only rendered when >1 sessions exist */}
      {sessions.length > 1 && (
        <div className="flex border-b border-gray-800 overflow-x-auto">
          {sessions.map((s, i) => {
            const dotColor = PROVIDER_COLORS[s.provider] ?? 'bg-gray-400';
            return (
              <button
                key={s.id}
                onClick={() => setActiveIdx(i)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap shrink-0 transition-colors ${
                  i === clampedIdx
                    ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-800/30'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                {s.name !== undefined ? s.name.slice(0, 18) : s.id.slice(0, 8)}
              </button>
            );
          })}
        </div>
      )}

      <SessionCard session={session} todo={linkedTodo} onOpenTodo={onOpenTodo} />
    </div>
  );
}
