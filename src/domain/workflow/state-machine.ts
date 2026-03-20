/**
 * Data-driven state machine definitions for the workflow ticket lifecycle.
 *
 * Epic lifecycle: idea → triaging → specced → planning → splitting → in-progress → merged
 * Task lifecycle: blocked/ready → in-progress → code-review → done
 *
 * Human gates: spec-review, plan-review, final-review
 */
import type { StageDefinition, WorkflowState, WorkflowTicketType, HumanGateState } from '@foundation/types';

// ---------------------------------------------------------------------------
// Epic stage definitions
// ---------------------------------------------------------------------------

export const EPIC_STAGES: StageDefinition[] = [
  {
    state: 'idea',
    ticketType: 'epic',
    agentActionable: false,
    humanGate: false,
    validTransitions: [
      { to: 'triaging', trigger: 'auto' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'triaging',
    ticketType: 'epic',
    agentActionable: true,
    humanGate: false,
    agentRole: 'triage',
    agentCount: 1,
    validTransitions: [
      { to: 'needs-input', trigger: 'agent-complete', condition: 'Agent has unanswered questions' },
      { to: 'specced', trigger: 'agent-complete', condition: 'Agent declares spec complete' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'needs-input',
    ticketType: 'epic',
    agentActionable: false,
    humanGate: false,
    validTransitions: [
      { to: 'triaging', trigger: 'manual', condition: 'Human provides answers' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'specced',
    ticketType: 'epic',
    agentActionable: false,
    humanGate: false,
    validTransitions: [
      { to: 'spec-review', trigger: 'auto' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'spec-review',
    ticketType: 'epic',
    agentActionable: false,
    humanGate: true,
    validTransitions: [
      { to: 'planning', trigger: 'human-approve' },
      { to: 'triaging', trigger: 'human-reject', condition: 'Feedback attached' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'planning',
    ticketType: 'epic',
    agentActionable: true,
    humanGate: false,
    agentRole: 'planner',
    agentCount: 3,
    parallel: true,
    validTransitions: [
      { to: 'plan-critique', trigger: 'agent-complete' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'plan-critique',
    ticketType: 'epic',
    agentActionable: true,
    humanGate: false,
    agentRole: 'plan-critic',
    agentCount: 2,
    parallel: true,
    validTransitions: [
      { to: 'plan-review', trigger: 'agent-complete', condition: 'No blocking findings' },
      { to: 'planning', trigger: 'agent-complete', condition: 'Blocking findings exist' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'plan-review',
    ticketType: 'epic',
    agentActionable: false,
    humanGate: true,
    validTransitions: [
      { to: 'executing', trigger: 'human-approve' },
      { to: 'planning', trigger: 'human-reject', condition: 'Feedback attached' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'executing',
    ticketType: 'epic',
    agentActionable: false,
    humanGate: false,
    validTransitions: [
      { to: 'integration-review', trigger: 'execution-complete' },
      { to: 'execution-failed', trigger: 'execution-failed' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'execution-failed',
    ticketType: 'epic',
    agentActionable: false,
    humanGate: false,
    validTransitions: [
      { to: 'executing', trigger: 'manual', condition: 'Retry execution' },
      { to: 'planning', trigger: 'manual', condition: 'Rework plan' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'splitting',
    ticketType: 'epic',
    agentActionable: true,
    humanGate: false,
    agentRole: 'splitter',
    agentCount: 1,
    validTransitions: [
      { to: 'in-progress', trigger: 'agent-complete', condition: 'Child tasks created' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'in-progress',
    ticketType: 'epic',
    agentActionable: false,
    humanGate: false,
    validTransitions: [
      { to: 'integration-review', trigger: 'all-tasks-done' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'integration-review',
    ticketType: 'epic',
    agentActionable: true,
    humanGate: false,
    agentRole: 'integration-reviewer',
    agentCount: 2,
    parallel: true,
    validTransitions: [
      { to: 'final-review', trigger: 'agent-complete', condition: 'No blocking findings' },
      { to: 'integration-fix', trigger: 'agent-complete', condition: 'Blocking findings exist' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'integration-fix',
    ticketType: 'epic',
    agentActionable: true,
    humanGate: false,
    agentRole: 'fixer',
    agentCount: 1,
    validTransitions: [
      { to: 'integration-review', trigger: 'agent-complete' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'final-review',
    ticketType: 'epic',
    agentActionable: false,
    humanGate: true,
    validTransitions: [
      { to: 'approved', trigger: 'human-approve' },
      { to: 'integration-fix', trigger: 'human-reject', condition: 'Feedback attached' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'approved',
    ticketType: 'epic',
    agentActionable: false,
    humanGate: false,
    validTransitions: [
      { to: 'merged', trigger: 'manual' },
    ],
  },
  {
    state: 'merged',
    ticketType: 'epic',
    agentActionable: false,
    humanGate: false,
    validTransitions: [],
  },
  {
    state: 'cancelled',
    ticketType: 'epic',
    agentActionable: false,
    humanGate: false,
    validTransitions: [],
  },
];

// ---------------------------------------------------------------------------
// Task stage definitions
// ---------------------------------------------------------------------------

export const TASK_STAGES: StageDefinition[] = [
  {
    state: 'blocked',
    ticketType: 'task',
    agentActionable: false,
    humanGate: false,
    validTransitions: [
      { to: 'ready', trigger: 'all-deps-resolved' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'ready',
    ticketType: 'task',
    agentActionable: true,
    humanGate: false,
    agentRole: 'implementer',
    agentCount: 1,
    validTransitions: [
      { to: 'in-progress', trigger: 'auto' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'in-progress',
    ticketType: 'task',
    agentActionable: true,
    humanGate: false,
    agentRole: 'implementer',
    agentCount: 1,
    validTransitions: [
      { to: 'code-review', trigger: 'agent-complete' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'code-review',
    ticketType: 'task',
    agentActionable: true,
    humanGate: false,
    agentRole: 'code-reviewer',
    agentCount: 1,
    validTransitions: [
      { to: 'done', trigger: 'agent-complete', condition: 'Review passes' },
      { to: 'changes-requested', trigger: 'agent-complete', condition: 'Review finds issues' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'changes-requested',
    ticketType: 'task',
    agentActionable: true,
    humanGate: false,
    agentRole: 'implementer',
    agentCount: 1,
    validTransitions: [
      { to: 'in-progress', trigger: 'auto' },
      { to: 'cancelled', trigger: 'manual' },
    ],
  },
  {
    state: 'done',
    ticketType: 'task',
    agentActionable: false,
    humanGate: false,
    validTransitions: [],
  },
  {
    state: 'cancelled',
    ticketType: 'task',
    agentActionable: false,
    humanGate: false,
    validTransitions: [],
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers (pure functions)
// ---------------------------------------------------------------------------

const ALL_STAGES = [...EPIC_STAGES, ...TASK_STAGES];

const stageMap = new Map<string, StageDefinition>();
for (const stage of ALL_STAGES) {
  stageMap.set(`${stage.ticketType}:${stage.state}`, stage);
}

/** Get the stage definition for a given ticket type and state */
export function getStageDefinition(
  ticketType: WorkflowTicketType,
  state: WorkflowState,
): StageDefinition | undefined {
  return stageMap.get(`${ticketType}:${state}`);
}

/** Check if a transition from one state to another is valid */
export function isValidTransition(
  ticketType: WorkflowTicketType,
  fromState: WorkflowState,
  toState: WorkflowState,
): boolean {
  const stage = getStageDefinition(ticketType, fromState);
  if (!stage) return false;
  return stage.validTransitions.some((t) => t.to === toState);
}

/** Check if a state is a human gate requiring approval */
export function isHumanGate(state: WorkflowState): state is HumanGateState {
  return state === 'spec-review' || state === 'plan-review' || state === 'final-review';
}

/** Check if a state is terminal (no further transitions) */
export function isTerminal(ticketType: WorkflowTicketType, state: WorkflowState): boolean {
  const stage = getStageDefinition(ticketType, state);
  if (!stage) return true;
  return stage.validTransitions.length === 0;
}

/** Check if a state is agent-actionable (system dispatches agents) */
export function isAgentActionable(ticketType: WorkflowTicketType, state: WorkflowState): boolean {
  const stage = getStageDefinition(ticketType, state);
  return stage?.agentActionable ?? false;
}

/** Get all states for a ticket type */
export function getStatesForType(ticketType: WorkflowTicketType): WorkflowState[] {
  return ALL_STAGES
    .filter((s) => s.ticketType === ticketType)
    .map((s) => s.state);
}

/** Get the initial state for a ticket type */
export function getInitialState(ticketType: WorkflowTicketType): WorkflowState {
  return ticketType === 'epic' ? 'idea' : 'ready';
}

/** Get ALL transitions for a ticket type (flattened from stage definitions) */
export function getAllTransitions(ticketType: WorkflowTicketType): Array<{
  from: WorkflowState;
  to: WorkflowState;
  trigger: string;
}> {
  const stages = ticketType === 'epic' ? EPIC_STAGES : TASK_STAGES;
  const transitions: Array<{ from: WorkflowState; to: WorkflowState; trigger: string }> = [];
  for (const stage of stages) {
    for (const t of stage.validTransitions) {
      transitions.push({ from: stage.state, to: t.to, trigger: t.trigger });
    }
  }
  return transitions;
}
