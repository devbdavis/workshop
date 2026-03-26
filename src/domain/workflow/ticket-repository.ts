/**
 * Repository interfaces for workflow ticket persistence.
 *
 * States and roles are string-based (runtime validated via Zod schemas in
 * domain/workflow/schemas.ts) rather than compile-time union types.
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
    | 'playbookRowId'
    | 'playbookVersion'
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
