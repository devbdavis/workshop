
// Semantic role type from dynamic workflow schemas
type SemanticRole = 'entry' | 'processing' | 'human-gate' | 'terminal' | 'error' | 'waiting';

interface Props {
  state: string;
  issueType: 'epic' | 'task';
  size?: 'sm' | 'md';
  /** Optional stateData for dynamic workflow semantic role lookup */
  stateData?: Record<string, unknown>;
}

/** Legacy states where the agent is actively working */
const LEGACY_AGENT_WORKING_STATES = new Set([
  'triaging',
  'planning',
  'plan-critique',
  'splitting',
  'integration-review',
  'integration-fix',
  'code-review',
  'changes-requested',
]);

/** Legacy states that require human approval */
const LEGACY_HUMAN_GATE_STATES = new Set([
  'spec-review',
  'plan-review',
  'final-review',
  'needs-input',
]);

/** Legacy terminal success states */
const LEGACY_SUCCESS_STATES = new Set(['done', 'approved', 'merged', 'specced']);

/** Color classes by semantic role (dynamic workflow) */
const SEMANTIC_ROLE_COLORS: Record<SemanticRole, string> = {
  'entry': 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
  'processing': 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
  'human-gate': 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  'terminal': 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
  'error': 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300',
  'waiting': 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300',
};

function getColorClasses(
  state: string,
  issueType: 'epic' | 'task',
  stateData?: Record<string, unknown>
): string {
  // First check for dynamic workflow semantic role
  const semanticRole = stateData?.currentStateSemanticRole as SemanticRole | undefined;
  if (semanticRole && SEMANTIC_ROLE_COLORS[semanticRole]) {
    // Special case: cancelled state is always red even if terminal
    if (state === 'cancelled') {
      return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300';
    }
    return SEMANTIC_ROLE_COLORS[semanticRole];
  }

  // Legacy fallback logic
  if (state === 'cancelled') return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300';
  if (LEGACY_SUCCESS_STATES.has(state)) return 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300';
  if (LEGACY_HUMAN_GATE_STATES.has(state)) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300';

  // in-progress is blue for tasks (agent working), gray for epics (waiting on children)
  if (state === 'in-progress') {
    if (issueType === 'task') return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300';
    return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
  }

  if (LEGACY_AGENT_WORKING_STATES.has(state)) return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300';

  // Default: idea, blocked, ready, etc.
  return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
}

function formatStateName(state: string): string {
  const spaced = state.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function WorkflowStateIndicator({ state, issueType, size = 'sm', stateData }: Props) {
  const colorClasses = getColorClasses(state, issueType, stateData);
  const sizeClasses = size === 'sm'
    ? 'text-[10px] px-1.5 py-0.5'
    : 'text-xs px-2 py-1';

  return (
    <span className={`inline-block rounded font-medium ${sizeClasses} ${colorClasses}`}>
      {formatStateName(state)}
    </span>
  );
}
