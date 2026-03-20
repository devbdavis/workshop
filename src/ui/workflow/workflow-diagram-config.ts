/**
 * Layout configuration for workflow state diagram visualization.
 * Pure data definitions — no React dependencies.
 */

export type NodeType = 'auto' | 'agent' | 'human-gate' | 'terminal' | 'waiting';

export interface DiagramNode {
  id: string;
  label: string;
  x: number;
  y: number;
  type: NodeType;
  /** Agent role if agent-actionable */
  agentRole?: string;
  /** Number of parallel agents */
  agentCount?: number;
  /** Phase grouping label */
  phase: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  trigger: string;
  /** If true, this is a rejection/backward edge */
  backward?: boolean;
}

export interface DiagramConfig {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Epic diagram configuration
// ---------------------------------------------------------------------------

const epicNodes: DiagramNode[] = [
  // Phase: Triage
  { id: 'idea', label: 'Idea', x: 400, y: 45, type: 'auto', phase: 'Triage' },
  { id: 'triaging', label: 'Triaging', x: 280, y: 130, type: 'agent', agentRole: 'triage', agentCount: 1, phase: 'Triage' },
  { id: 'needs-input', label: 'Needs Input', x: 520, y: 130, type: 'waiting', phase: 'Triage' },
  { id: 'specced', label: 'Specced', x: 400, y: 215, type: 'auto', phase: 'Triage' },

  // Phase: Spec Review
  { id: 'spec-review', label: 'Spec Review', x: 400, y: 300, type: 'human-gate', phase: 'Spec Review' },

  // Phase: Planning
  { id: 'planning', label: 'Planning', x: 280, y: 390, type: 'agent', agentRole: 'planner', agentCount: 3, phase: 'Planning' },
  { id: 'plan-critique', label: 'Plan Critique', x: 520, y: 390, type: 'agent', agentRole: 'plan-critic', agentCount: 2, phase: 'Planning' },

  // Phase: Plan Review
  { id: 'plan-review', label: 'Plan Review', x: 400, y: 475, type: 'human-gate', phase: 'Plan Review' },

  // Phase: Execution
  { id: 'executing', label: 'Executing', x: 280, y: 565, type: 'waiting', phase: 'Execution' },
  { id: 'execution-failed', label: 'Exec Failed', x: 520, y: 565, type: 'waiting', phase: 'Execution' },

  // Phase: Task Management
  { id: 'splitting', label: 'Splitting', x: 400, y: 645, type: 'agent', agentRole: 'splitter', agentCount: 1, phase: 'Task Management' },
  { id: 'in-progress', label: 'In Progress', x: 400, y: 720, type: 'waiting', phase: 'Task Management' },

  // Phase: Integration
  { id: 'integration-review', label: 'Integration Review', x: 280, y: 805, type: 'agent', agentRole: 'integration-reviewer', agentCount: 2, phase: 'Integration' },
  { id: 'integration-fix', label: 'Integration Fix', x: 520, y: 805, type: 'agent', agentRole: 'fixer', agentCount: 1, phase: 'Integration' },

  // Phase: Final Review
  { id: 'final-review', label: 'Final Review', x: 400, y: 890, type: 'human-gate', phase: 'Final Review' },

  // Phase: Done
  { id: 'approved', label: 'Approved', x: 400, y: 970, type: 'terminal', phase: 'Done' },
  { id: 'merged', label: 'Merged', x: 400, y: 1040, type: 'terminal', phase: 'Done' },

  // Side: Cancelled
  { id: 'cancelled', label: 'Cancelled', x: 700, y: 550, type: 'terminal', phase: 'Side' },
];

const epicEdges: DiagramEdge[] = [
  // Forward flow
  { from: 'idea', to: 'triaging', trigger: 'auto' },
  { from: 'triaging', to: 'needs-input', trigger: 'questions' },
  { from: 'triaging', to: 'specced', trigger: 'complete' },
  { from: 'needs-input', to: 'triaging', trigger: 'answered' },
  { from: 'specced', to: 'spec-review', trigger: 'auto' },
  { from: 'spec-review', to: 'planning', trigger: 'approve' },
  { from: 'planning', to: 'plan-critique', trigger: 'complete' },
  { from: 'plan-critique', to: 'plan-review', trigger: 'complete' },
  { from: 'plan-review', to: 'executing', trigger: 'approve' },
  { from: 'executing', to: 'splitting', trigger: 'complete' },
  { from: 'executing', to: 'execution-failed', trigger: 'failed' },
  { from: 'execution-failed', to: 'executing', trigger: 'retry' },
  { from: 'execution-failed', to: 'planning', trigger: 'rework', backward: true },
  { from: 'splitting', to: 'in-progress', trigger: 'complete' },
  { from: 'in-progress', to: 'integration-review', trigger: 'tasks done' },
  { from: 'integration-review', to: 'final-review', trigger: 'pass' },
  { from: 'integration-review', to: 'integration-fix', trigger: 'findings' },
  { from: 'integration-fix', to: 'integration-review', trigger: 'complete' },
  { from: 'final-review', to: 'approved', trigger: 'approve' },
  { from: 'approved', to: 'merged', trigger: 'merge' },

  // Rejection edges
  { from: 'spec-review', to: 'triaging', trigger: 'reject', backward: true },
  { from: 'plan-review', to: 'planning', trigger: 'reject', backward: true },
  { from: 'final-review', to: 'integration-fix', trigger: 'reject', backward: true },
];

export const EPIC_DIAGRAM_CONFIG: DiagramConfig = {
  nodes: epicNodes,
  edges: epicEdges,
  width: 800,
  height: 1100,
};

// ---------------------------------------------------------------------------
// Task diagram configuration
// ---------------------------------------------------------------------------

const taskNodes: DiagramNode[] = [
  { id: 'blocked', label: 'Blocked', x: 300, y: 45, type: 'waiting', phase: 'Setup' },
  { id: 'ready', label: 'Ready', x: 300, y: 130, type: 'agent', agentRole: 'implementer', agentCount: 1, phase: 'Setup' },
  { id: 'in-progress', label: 'In Progress', x: 300, y: 220, type: 'agent', agentRole: 'implementer', agentCount: 1, phase: 'Implementation' },
  { id: 'code-review', label: 'Code Review', x: 300, y: 310, type: 'agent', agentRole: 'code-reviewer', agentCount: 1, phase: 'Review' },
  { id: 'changes-requested', label: 'Changes Requested', x: 480, y: 310, type: 'agent', agentRole: 'implementer', agentCount: 1, phase: 'Review' },
  { id: 'done', label: 'Done', x: 300, y: 400, type: 'terminal', phase: 'Done' },
  { id: 'cancelled', label: 'Cancelled', x: 500, y: 220, type: 'terminal', phase: 'Side' },
];

const taskEdges: DiagramEdge[] = [
  { from: 'blocked', to: 'ready', trigger: 'deps resolved' },
  { from: 'ready', to: 'in-progress', trigger: 'auto' },
  { from: 'in-progress', to: 'code-review', trigger: 'complete' },
  { from: 'code-review', to: 'done', trigger: 'pass' },
  { from: 'code-review', to: 'changes-requested', trigger: 'issues' },
  { from: 'changes-requested', to: 'in-progress', trigger: 'auto', backward: true },
];

export const TASK_DIAGRAM_CONFIG: DiagramConfig = {
  nodes: taskNodes,
  edges: taskEdges,
  width: 600,
  height: 500,
};

// ---------------------------------------------------------------------------
// Node styling configuration
// ---------------------------------------------------------------------------

export interface NodeStyle {
  fill: string;
  stroke: string;
  textColor: string;
}

export const NODE_STYLES: Record<NodeType, NodeStyle> = {
  auto: { fill: 'rgb(55, 65, 81)', stroke: 'rgb(75, 85, 99)', textColor: 'rgb(229, 231, 235)' },
  agent: { fill: 'rgb(30, 58, 138)', stroke: 'rgb(59, 130, 246)', textColor: 'rgb(229, 231, 235)' },
  'human-gate': { fill: 'rgb(120, 53, 15)', stroke: 'rgb(245, 158, 11)', textColor: 'rgb(229, 231, 235)' },
  terminal: { fill: 'rgb(20, 83, 45)', stroke: 'rgb(34, 197, 94)', textColor: 'rgb(229, 231, 235)' },
  waiting: { fill: 'rgb(55, 48, 83)', stroke: 'rgb(168, 85, 247)', textColor: 'rgb(229, 231, 235)' },
};

// ---------------------------------------------------------------------------
// Phase band configuration
// ---------------------------------------------------------------------------

export interface PhaseBand {
  phase: string;
  yStart: number;
  yEnd: number;
}

function computePhaseBands(nodes: DiagramNode[], padding = 35): PhaseBand[] {
  const phaseMinMax = new Map<string, { min: number; max: number }>();
  for (const node of nodes) {
    if (node.phase === 'Side') continue;
    const existing = phaseMinMax.get(node.phase);
    if (existing) {
      existing.min = Math.min(existing.min, node.y);
      existing.max = Math.max(existing.max, node.y);
    } else {
      phaseMinMax.set(node.phase, { min: node.y, max: node.y });
    }
  }
  const bands: PhaseBand[] = [];
  for (const [phase, { min, max }] of phaseMinMax) {
    bands.push({ phase, yStart: min - padding, yEnd: max + padding });
  }
  return bands.sort((a, b) => a.yStart - b.yStart);
}

export const EPIC_PHASE_BANDS = computePhaseBands(epicNodes);
export const TASK_PHASE_BANDS = computePhaseBands(taskNodes);

/** Get diagram config by ticket type */
export function getDiagramConfig(ticketType: 'epic' | 'task'): DiagramConfig {
  return ticketType === 'epic' ? EPIC_DIAGRAM_CONFIG : TASK_DIAGRAM_CONFIG;
}

/** Get phase bands by ticket type */
export function getPhaseBands(ticketType: 'epic' | 'task'): PhaseBand[] {
  return ticketType === 'epic' ? EPIC_PHASE_BANDS : TASK_PHASE_BANDS;
}
