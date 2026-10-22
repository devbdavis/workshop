/**
 * Dark Factory autonomy predicate + budget defaults, shared across the engine,
 * dispatch coordinator, and dispatchers so the safety-critical "is this issue
 * running dark?" check can never drift between call sites.
 */
import type { WorkflowIssue } from '@foundation/types.js';
import type { WorkflowIssueRepository } from '@domain/workflow/issue-repository.js';

export interface AutonomousBudget {
  maxSteps: number;
  maxWallClockMs: number;
}

/** Default whole-issue autonomy budget when the epic doesn't specify one. */
export const DEFAULT_AUTONOMOUS_BUDGET: AutonomousBudget = {
  maxSteps: 40,
  maxWallClockMs: 4 * 60 * 60 * 1000,
};

/**
 * An issue runs autonomous if it (or its parent epic) has
 * stateData.autonomous === true. Tasks inherit autonomy from their epic.
 */
export function isAutonomous(issue: WorkflowIssue, issues: WorkflowIssueRepository): boolean {
  const sd = (issue.stateData || {}) as Record<string, unknown>;
  if (sd.autonomous === true) return true;
  if (issue.parentId) {
    const parent = issues.findById(issue.parentId);
    return (parent?.stateData as Record<string, unknown> | undefined)?.autonomous === true;
  }
  return false;
}
