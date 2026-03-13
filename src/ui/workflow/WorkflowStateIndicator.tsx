interface Props {
  state: string;
  ticketType: 'epic' | 'task';
  size?: 'sm' | 'md';
}

/** States where the agent is actively working */
const AGENT_WORKING_STATES = new Set([
  'triaging',
  'planning',
  'plan-critique',
  'splitting',
  'integration-review',
  'integration-fix',
  'code-review',
  'changes-requested',
]);

/** States that require human approval */
const HUMAN_GATE_STATES = new Set([
  'spec-review',
  'plan-review',
  'final-review',
  'needs-input',
]);

/** Terminal success states */
const SUCCESS_STATES = new Set(['done', 'approved', 'merged', 'specced']);

function getColorClasses(state: string, ticketType: 'epic' | 'task'): string {
  if (state === 'cancelled') return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300';
  if (SUCCESS_STATES.has(state)) return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300';
  if (HUMAN_GATE_STATES.has(state)) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300';

  // in-progress is blue for tasks (agent working), gray for epics (waiting on children)
  if (state === 'in-progress') {
    if (ticketType === 'task') return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300';
    return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  }

  if (AGENT_WORKING_STATES.has(state)) return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300';

  // Default: idea, blocked, ready, etc.
  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
}

function formatStateName(state: string): string {
  const spaced = state.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function WorkflowStateIndicator({ state, ticketType, size = 'sm' }: Props) {
  const colorClasses = getColorClasses(state, ticketType);
  const sizeClasses = size === 'sm'
    ? 'text-[10px] px-1.5 py-0.5'
    : 'text-xs px-2 py-1';

  return (
    <span className={`inline-block rounded font-medium ${sizeClasses} ${colorClasses}`}>
      {formatStateName(state)}
    </span>
  );
}
