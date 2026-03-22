/**
 * Resolves inter-ticket dependencies and detects when blocked tickets become unblocked.
 */
import type { WorkflowTicketId } from '@foundation/types';
import type { WorkflowTicketRepository, TicketDependencyRepository } from './ticket-repository.js';

export interface DependencyResolver {
  /** Check if all dependencies for a ticket are resolved */
  allResolved(ticketId: WorkflowTicketId): boolean;

  /** Resolve dependency and return tickets that became unblocked */
  resolveAndUnblock(completedTicketId: WorkflowTicketId): WorkflowTicketId[];

  /** Check if all child tasks of an epic are done */
  allChildrenDone(epicId: WorkflowTicketId): boolean;
}

export interface DependencyResolverDeps {
  tickets: WorkflowTicketRepository;
  dependencies: TicketDependencyRepository;
}

export function createDependencyResolver(deps: DependencyResolverDeps): DependencyResolver {
  const { tickets, dependencies } = deps;

  return {
    allResolved(ticketId: WorkflowTicketId): boolean {
      const unresolved = dependencies.findUnresolved(ticketId);
      return unresolved.length === 0;
    },

    resolveAndUnblock(completedTicketId: WorkflowTicketId): WorkflowTicketId[] {
      // Find all dependency records where something depends ON the completed ticket
      const dependents = dependencies.findDependents(completedTicketId);
      const unblockedIds: WorkflowTicketId[] = [];

      for (const dep of dependents) {
        // Mark this specific dependency as resolved
        dependencies.resolve(dep.ticketId, completedTicketId);

        // Check if the dependent ticket now has zero unresolved deps
        const remaining = dependencies.findUnresolved(dep.ticketId);
        if (remaining.length === 0) {
          // Only unblock if the ticket is actually in 'blocked' state
          const ticket = tickets.findById(dep.ticketId);
          if (ticket && ticket.state === 'blocked') {
            unblockedIds.push(dep.ticketId);
          }
        }
      }

      return unblockedIds;
    },

    allChildrenDone(epicId: WorkflowTicketId): boolean {
      const children = tickets.findChildren(epicId);
      if (children.length === 0) return false;
      return children.every((child) => child.state === 'done' || child.state === 'cancelled');
    },
  };
}
