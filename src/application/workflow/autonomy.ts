/**
 * Dark Factory autonomy predicate + budget defaults, shared across the engine,
 * dispatch coordinator, and dispatchers so the safety-critical "is this ticket
 * running dark?" check can never drift between call sites.
 */
import type { WorkflowTicket } from '@foundation/types.js';
import type { WorkflowTicketRepository } from '@domain/workflow/ticket-repository.js';

export interface AutonomousBudget {
  maxSteps: number;
  maxWallClockMs: number;
}

/** Default whole-ticket autonomy budget when the epic doesn't specify one. */
export const DEFAULT_AUTONOMOUS_BUDGET: AutonomousBudget = {
  maxSteps: 40,
  maxWallClockMs: 4 * 60 * 60 * 1000,
};

/**
 * A ticket runs autonomous if it (or its parent epic) has
 * stateData.autonomous === true. Tasks inherit autonomy from their epic.
 */
export function isAutonomous(ticket: WorkflowTicket, tickets: WorkflowTicketRepository): boolean {
  const sd = (ticket.stateData || {}) as Record<string, unknown>;
  if (sd.autonomous === true) return true;
  if (ticket.parentId) {
    const parent = tickets.findById(ticket.parentId);
    return (parent?.stateData as Record<string, unknown> | undefined)?.autonomous === true;
  }
  return false;
}
