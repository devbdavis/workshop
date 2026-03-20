/**
 * Workflow template definitions — predefined flow diagrams controlling
 * which states a ticket goes through.
 *
 * Templates allow creating tickets at different entry points, skipping
 * earlier stages when appropriate (e.g., "From Plan" skips triage/planning).
 */
import type { WorkflowTicketType, WorkflowState, EpicState, TaskState } from '@foundation/types';

/** Defines a reusable workflow template — a named subset of the state machine */
export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  ticketType: WorkflowTicketType;
  /** The state to create the ticket at */
  entryState: WorkflowState;
  /** All states reachable from the entry state in this template's flow */
  activeStates: WorkflowState[];
  /** States from the full state machine that are skipped by this template */
  skippedStates: WorkflowState[];
  /** Fields required at ticket creation for this template */
  requiredFields: ('description' | 'planDraft')[];
  /** Whether this is a built-in template (cannot be deleted) */
  builtin: boolean;
}

// ---------------------------------------------------------------------------
// Epic templates
// ---------------------------------------------------------------------------

export const EPIC_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'epic-standard',
    name: 'Standard',
    description: 'Full workflow: triage -> spec -> plan -> execute -> review -> merge',
    ticketType: 'epic',
    entryState: 'idea' as EpicState,
    activeStates: [
      'idea', 'triaging', 'needs-input', 'specced', 'spec-review',
      'planning', 'plan-critique', 'plan-review',
      'executing', 'execution-failed',
      'splitting', 'in-progress',
      'integration-review', 'integration-fix',
      'final-review', 'approved', 'merged', 'cancelled',
    ] as EpicState[],
    skippedStates: [] as EpicState[],
    requiredFields: ['description'],
    builtin: true,
  },
  {
    id: 'epic-from-plan',
    name: 'From Plan',
    description: 'Skip triage and planning — start with a pre-written plan at review',
    ticketType: 'epic',
    entryState: 'plan-review' as EpicState,
    activeStates: [
      'plan-review',
      'executing', 'execution-failed',
      'splitting', 'in-progress',
      'integration-review', 'integration-fix',
      'final-review', 'approved', 'merged', 'cancelled',
      'planning',  // reachable via reject from plan-review
    ] as EpicState[],
    skippedStates: [
      'idea', 'triaging', 'needs-input', 'specced', 'spec-review',
      'plan-critique',
    ] as EpicState[],
    requiredFields: ['planDraft'],
    builtin: true,
  },
  {
    id: 'epic-direct-execute',
    name: 'Direct Execute',
    description: 'Skip all planning — provide a plan and go straight to execution',
    ticketType: 'epic',
    entryState: 'executing' as EpicState,
    activeStates: [
      'executing', 'execution-failed',
      'splitting', 'in-progress',
      'integration-review', 'integration-fix',
      'final-review', 'approved', 'merged', 'cancelled',
    ] as EpicState[],
    skippedStates: [
      'idea', 'triaging', 'needs-input', 'specced', 'spec-review',
      'planning', 'plan-critique', 'plan-review',
    ] as EpicState[],
    requiredFields: ['description', 'planDraft'],
    builtin: true,
  },
];

// ---------------------------------------------------------------------------
// Task templates
// ---------------------------------------------------------------------------

export const TASK_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'task-standard',
    name: 'Standard',
    description: 'Full task flow: implement -> review -> done',
    ticketType: 'task',
    entryState: 'ready' as TaskState,
    activeStates: [
      'blocked', 'ready', 'in-progress', 'code-review',
      'changes-requested', 'done', 'cancelled',
    ] as TaskState[],
    skippedStates: [] as TaskState[],
    requiredFields: ['description'],
    builtin: true,
  },
];

// ---------------------------------------------------------------------------
// Combined exports and lookup helpers
// ---------------------------------------------------------------------------

export const ALL_TEMPLATES = [...EPIC_TEMPLATES, ...TASK_TEMPLATES];

/** Find a template by its unique ID */
export function getTemplateById(id: string): WorkflowTemplate | undefined {
  return ALL_TEMPLATES.find(t => t.id === id);
}

/** Get all templates available for a specific ticket type */
export function getTemplatesForType(ticketType: WorkflowTicketType): WorkflowTemplate[] {
  return ALL_TEMPLATES.filter(t => t.ticketType === ticketType);
}
