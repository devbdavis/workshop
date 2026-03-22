/**
 * Unified orchestrator that wraps the workflow engine, execution dispatcher,
 * and agent dispatcher into a single coordination point.
 *
 * All state transitions flow through here so dispatch side-effects are
 * consistently triggered regardless of the caller (HTTP routes, MCP tools,
 * automation rules).
 */
import type {
  WorkflowTicket,
  WorkflowTicketId,
  WorkflowState,
  TransitionActor,
} from '@foundation/types';
import type { WorkflowTicketRepository } from './ticket-repository.js';
import type { WorkflowEngine } from './engine.js';
import type { ExecutionDispatcher } from './execution-dispatcher.js';
import type { AgentDispatcher } from './agent-dispatcher.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface DispatchCoordinator {
  /** Transition a ticket and auto-dispatch agents if the target state is agent-actionable */
  transitionWithDispatch(
    ticketId: WorkflowTicketId,
    toState: WorkflowState,
    actor: TransitionActor,
    comment?: string,
    data?: Record<string, unknown>,
  ): Promise<WorkflowTicket>;

  /** Approve at human gate and dispatch if result state needs agents */
  approveWithDispatch(ticketId: WorkflowTicketId, comment?: string): Promise<WorkflowTicket>;

  /** Reject at human gate — may dispatch if target state is agent-actionable */
  reject(ticketId: WorkflowTicketId, comment?: string): Promise<WorkflowTicket>;

  /** Dispatch agents for a ticket that is already in an agent-actionable state (e.g. retry) */
  dispatchForCurrentState(ticketId: WorkflowTicketId): Promise<void>;
}

export interface DispatchCoordinatorDeps {
  engine: WorkflowEngine;
  tickets: WorkflowTicketRepository;
  executionDispatcher: ExecutionDispatcher;
  agentDispatcher: AgentDispatcher;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createDispatchCoordinator(
  deps: DispatchCoordinatorDeps,
): DispatchCoordinator {
  const { engine, tickets, executionDispatcher, agentDispatcher } = deps;

  async function dispatchIfNeeded(ticket: WorkflowTicket): Promise<void> {
    if (ticket.state === 'executing') {
      try {
        await executionDispatcher.dispatch(ticket.id);
      } catch (err) {
        console.error('Execution dispatch failed:', err);
        try {
          engine.transition(
            ticket.id,
            'execution-failed',
            { type: 'system', reason: 'Dispatch failed' },
            err instanceof Error ? err.message : 'Failed to dispatch execution session',
          );
        } catch {
          console.error('Failed to mark ticket as execution-failed:', ticket.id);
        }
      }
      return;
    }

    // General agent dispatch for all other agent-actionable states
    await agentDispatcher.onTransition(ticket);
  }

  return {
    async transitionWithDispatch(
      ticketId: WorkflowTicketId,
      toState: WorkflowState,
      actor: TransitionActor,
      comment?: string,
      data?: Record<string, unknown>,
    ): Promise<WorkflowTicket> {
      const updated = engine.transition(ticketId, toState, actor, comment, data);

      // If a task reached 'done', resolve dependencies and check epic progress
      if (toState === 'done') {
        engine.onTaskCompleted(ticketId);
      }

      await dispatchIfNeeded(updated);

      // Re-read in case dispatchIfNeeded updated stateData
      return tickets.findById(ticketId) ?? updated;
    },

    async approveWithDispatch(
      ticketId: WorkflowTicketId,
      comment?: string,
    ): Promise<WorkflowTicket> {
      const updated = engine.approve(ticketId, comment);

      await dispatchIfNeeded(updated);

      return tickets.findById(ticketId) ?? updated;
    },

    async reject(ticketId: WorkflowTicketId, comment?: string): Promise<WorkflowTicket> {
      const updated = engine.reject(ticketId, comment);

      // Rejection can land on agent-actionable states (e.g. final-review → integration-fix)
      await dispatchIfNeeded(updated);

      return tickets.findById(ticketId) ?? updated;
    },

    async dispatchForCurrentState(ticketId: WorkflowTicketId): Promise<void> {
      const ticket = tickets.findById(ticketId);
      if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);
      await dispatchIfNeeded(ticket);
    },
  };
}
