/**
 * Repository interfaces for workflow ticket persistence.
 *
 * Moved from domain/workflow/repository.ts to application layer as part of
 * the dynamic workflow engine refactor — repositories now use string-based
 * types for states and roles (runtime validated via Zod schemas).
 */
import type {
  WorkflowTicket,
  WorkflowTicketId,
  WorkflowTransition,
  WorkflowTransitionId,
  TicketDependency,
  WorkflowState,
  WorkflowTicketType,
  TrackId,
} from '@foundation/types.js';

// ---------------------------------------------------------------------------
// WorkflowTicket repository
// ---------------------------------------------------------------------------

export type WorkflowTicketCreate = Omit<
  WorkflowTicket,
  'id' | 'childIds' | 'stateChangedAt' | 'createdAt' | 'updatedAt'
>;

export type WorkflowTicketUpdate = Partial<
  Pick<
    WorkflowTicket,
    | 'title'
    | 'description'
    | 'state'
    | 'stateData'
    | 'trackId'
    | 'externalTicketId'
    | 'executionSessionId'
    | 'assignedAgentRole'
    | 'assignedAgentIds'
    | 'provider'
    | 'priority'
    | 'labels'
    | 'sortOrder'
    | 'stateChangedAt'
    | 'workflowTemplateRowId'
    | 'workflowTemplateVersion'
  >
>;

export interface WorkflowTicketFilter {
  type?: WorkflowTicketType;
  state?: WorkflowState;
  trackId?: TrackId;
  parentId?: WorkflowTicketId;
}

export interface WorkflowTicketRepository {
  findById(id: WorkflowTicketId): WorkflowTicket | null;
  findAll(filters?: WorkflowTicketFilter): WorkflowTicket[];
  findChildren(parentId: WorkflowTicketId): WorkflowTicket[];
  findByState(state: WorkflowState): WorkflowTicket[];
  findByExecutionSessionId(sessionId: string): WorkflowTicket | null;
  findHumanGatePending(): WorkflowTicket[];
  create(ticket: WorkflowTicketCreate): WorkflowTicket;
  update(id: WorkflowTicketId, data: WorkflowTicketUpdate): WorkflowTicket | null;
  delete(id: WorkflowTicketId): boolean;
}

// ---------------------------------------------------------------------------
// WorkflowTransition repository (audit log)
// ---------------------------------------------------------------------------

export type WorkflowTransitionCreate = Omit<WorkflowTransition, 'id' | 'createdAt'>;

export interface WorkflowTransitionRepository {
  findByTicket(ticketId: WorkflowTicketId, limit?: number): WorkflowTransition[];
  findById(id: WorkflowTransitionId): WorkflowTransition | null;
  create(transition: WorkflowTransitionCreate): WorkflowTransition;
}

// ---------------------------------------------------------------------------
// TicketDependency repository
// ---------------------------------------------------------------------------

export interface TicketDependencyRepository {
  findByTicket(ticketId: WorkflowTicketId): TicketDependency[];
  findDependents(dependsOnId: WorkflowTicketId): TicketDependency[];
  findUnresolved(ticketId: WorkflowTicketId): TicketDependency[];
  create(ticketId: WorkflowTicketId, dependsOnId: WorkflowTicketId): TicketDependency;
  resolve(ticketId: WorkflowTicketId, dependsOnId: WorkflowTicketId): boolean;
  delete(ticketId: WorkflowTicketId, dependsOnId: WorkflowTicketId): boolean;
}
