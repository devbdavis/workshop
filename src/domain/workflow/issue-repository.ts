/**
 * Repository interfaces for workflow issue persistence.
 *
 * States and roles are string-based (runtime validated via Zod schemas in
 * domain/workflow/schemas.ts) rather than compile-time union types.
 */
import type {
  WorkflowIssue,
  WorkflowIssueId,
  WorkflowTransition,
  WorkflowTransitionId,
  IssueDependency,
  WorkflowState,
  WorkflowIssueType,
  TrackId,
} from '@foundation/types.js';

// ---------------------------------------------------------------------------
// WorkflowIssue repository
// ---------------------------------------------------------------------------

export type WorkflowIssueCreate = Omit<
  WorkflowIssue,
  'id' | 'childIds' | 'stateChangedAt' | 'createdAt' | 'updatedAt'
>;

export type WorkflowIssueUpdate = Partial<
  Pick<
    WorkflowIssue,
    | 'title'
    | 'description'
    | 'state'
    | 'stateData'
    | 'trackId'
    | 'externalIssueId'
    | 'executionSessionId'
    | 'assignedAgentRole'
    | 'assignedAgentIds'
    | 'provider'
    | 'priority'
    | 'labels'
    | 'sortOrder'
    | 'stateChangedAt'
    | 'playbookRowId'
    | 'playbookVersion'
  >
>;

export interface WorkflowIssueFilter {
  type?: WorkflowIssueType;
  state?: WorkflowState;
  trackId?: TrackId;
  parentId?: WorkflowIssueId;
}

export interface WorkflowIssueRepository {
  findById(id: WorkflowIssueId): WorkflowIssue | null;
  findAll(filters?: WorkflowIssueFilter): WorkflowIssue[];
  findChildren(parentId: WorkflowIssueId): WorkflowIssue[];
  findByState(state: WorkflowState): WorkflowIssue[];
  findByExecutionSessionId(sessionId: string): WorkflowIssue | null;
  findHumanGatePending(): WorkflowIssue[];
  create(issue: WorkflowIssueCreate): WorkflowIssue;
  update(id: WorkflowIssueId, data: WorkflowIssueUpdate): WorkflowIssue | null;
  delete(id: WorkflowIssueId): boolean;
}

// ---------------------------------------------------------------------------
// WorkflowTransition repository (audit log)
// ---------------------------------------------------------------------------

export type WorkflowTransitionCreate = Omit<WorkflowTransition, 'id' | 'createdAt'>;

export interface WorkflowTransitionRepository {
  findByIssue(issueId: WorkflowIssueId, limit?: number): WorkflowTransition[];
  findById(id: WorkflowTransitionId): WorkflowTransition | null;
  create(transition: WorkflowTransitionCreate): WorkflowTransition;
}

// ---------------------------------------------------------------------------
// IssueDependency repository
// ---------------------------------------------------------------------------

export interface IssueDependencyRepository {
  findByIssue(issueId: WorkflowIssueId): IssueDependency[];
  findDependents(dependsOnId: WorkflowIssueId): IssueDependency[];
  findUnresolved(issueId: WorkflowIssueId): IssueDependency[];
  create(issueId: WorkflowIssueId, dependsOnId: WorkflowIssueId): IssueDependency;
  resolve(issueId: WorkflowIssueId, dependsOnId: WorkflowIssueId): boolean;
  delete(issueId: WorkflowIssueId, dependsOnId: WorkflowIssueId): boolean;
}
