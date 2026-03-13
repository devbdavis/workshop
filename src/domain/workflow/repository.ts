import type {
  WorkflowTicket,
  WorkflowTicketId,
  WorkflowTransition,
  WorkflowTransitionId,
  TicketDependency,
  WorkflowState,
  WorkflowTicketType,
  TrackId,
  TransitionActor,
} from '@foundation/types';

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
    | 'assignedAgentRole'
    | 'assignedAgentIds'
    | 'provider'
    | 'priority'
    | 'labels'
    | 'sortOrder'
    | 'stateChangedAt'
  >
>;

export interface WorkflowTicketRepository {
  findById(id: WorkflowTicketId): WorkflowTicket | null;
  findAll(filters?: {
    type?: WorkflowTicketType;
    state?: WorkflowState;
    trackId?: TrackId;
    parentId?: WorkflowTicketId;
  }): WorkflowTicket[];
  findChildren(parentId: WorkflowTicketId): WorkflowTicket[];
  findByState(state: WorkflowState): WorkflowTicket[];
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
