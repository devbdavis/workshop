/**
 * Resolves inter-ticket dependencies and detects when blocked tickets become unblocked.
 */
import type { WorkflowTicketId } from '@foundation/types.js';
import type { WorkflowTicketRepository, TicketDependencyRepository } from './ticket-repository.js';
import type { TopologyLoader } from './topology-loader.js';
import { isTerminal } from './types.js';

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
  topologyLoader: TopologyLoader;
}

export function createDependencyResolver(deps: DependencyResolverDeps): DependencyResolver {
  const { tickets, dependencies, topologyLoader } = deps;

  /** Check if a ticket is in a terminal state using topology or fallback. */
  function checkIsTerminal(ticket: { state: string; workflowTemplateRowId?: string }): boolean {
    try {
      if (ticket.workflowTemplateRowId) {
        const stages = topologyLoader.loadByTemplateRowId(ticket.workflowTemplateRowId);
        return isTerminal(stages, ticket.state);
      }
    } catch {
      // Template not found — fall through to hardcoded check
    }
    return ticket.state === 'done' || ticket.state === 'cancelled' || ticket.state === 'merged';
  }

  return {
    allResolved(ticketId: WorkflowTicketId): boolean {
      const unresolved = dependencies.findUnresolved(ticketId);
      return unresolved.length === 0;
    },

    resolveAndUnblock(completedTicketId: WorkflowTicketId): WorkflowTicketId[] {
      const dependents = dependencies.findDependents(completedTicketId);
      const unblockedIds: WorkflowTicketId[] = [];

      for (const dep of dependents) {
        dependencies.resolve(dep.ticketId, completedTicketId);

        const remaining = dependencies.findUnresolved(dep.ticketId);
        if (remaining.length === 0) {
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
      return children.every((child) => checkIsTerminal(child));
    },
  };
}
