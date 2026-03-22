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
} from '@foundation/types.js';
import type { WorkflowTicketRepository } from './ticket-repository.js';
import type { WorkflowEngine } from './engine.js';
import type { ExecutionDispatcher } from './execution-dispatcher.js';
import type { AgentDispatcher } from './agent-dispatcher.js';
import type { TopologyLoader } from './topology-loader.js';
import { getStageDefinition, isTerminal } from './types.js';

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
  topologyLoader: TopologyLoader;
  /** Called when an epic advances (used to re-wire engine callback) */
  onEpicAdvanced?: (ticket: WorkflowTicket) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a stage is an execution stage (has execution-complete or execution-failed triggers).
 */
function isExecutionStage(
  topologyLoader: TopologyLoader,
  ticket: WorkflowTicket,
): boolean {
  try {
    const stages = topologyLoader.loadForTicket(ticket);
    const stage = getStageDefinition(stages, ticket.state);
    return stage?.validTransitions.some(
      (t) => t.trigger === 'execution-complete' || t.trigger === 'execution-failed',
    ) ?? false;
  } catch {
    // No template — fallback to hardcoded check for backward compat
    return ticket.state === 'executing';
  }
}

/**
 * Find the target state for a given trigger from the current stage.
 */
function findTransitionTarget(
  topologyLoader: TopologyLoader,
  ticket: WorkflowTicket,
  trigger: string,
): string | null {
  try {
    const stages = topologyLoader.loadForTicket(ticket);
    const stage = getStageDefinition(stages, ticket.state);
    const transition = stage?.validTransitions.find((t) => t.trigger === trigger);
    return transition?.to ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createDispatchCoordinator(
  deps: DispatchCoordinatorDeps,
): DispatchCoordinator {
  const { engine, tickets, executionDispatcher, agentDispatcher, topologyLoader } = deps;

  async function dispatchIfNeeded(ticket: WorkflowTicket): Promise<void> {
    // Check if this is an execution stage
    if (isExecutionStage(topologyLoader, ticket)) {
      try {
        await executionDispatcher.dispatch(ticket.id);
      } catch (err) {
        console.error('Execution dispatch failed:', err);
        // Find the execution-failed target from topology
        const failedTarget = findTransitionTarget(topologyLoader, ticket, 'execution-failed');
        if (failedTarget) {
          try {
            engine.transition(
              ticket.id,
              failedTarget,
              { type: 'system', reason: 'Dispatch failed' },
              err instanceof Error ? err.message : 'Failed to dispatch execution session',
            );
          } catch {
            console.error('Failed to mark ticket as execution-failed:', ticket.id);
          }
        }
      }
      return;
    }

    // General agent dispatch for all other agent-actionable states
    await agentDispatcher.onTransition(ticket);
  }

  /**
   * Check if a state is terminal for task completion handling.
   */
  function checkIsTerminal(ticket: WorkflowTicket, state: WorkflowState): boolean {
    try {
      const stages = topologyLoader.loadForTicket(ticket);
      return isTerminal(stages, state);
    } catch {
      // No template — fallback to hardcoded check
      return state === 'done' || state === 'cancelled' || state === 'merged';
    }
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

      // If a task reached a terminal state, resolve dependencies and check epic progress
      if (updated.type === 'task' && checkIsTerminal(updated, toState)) {
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

      // Rejection can land on agent-actionable states (e.g. final-review -> integration-fix)
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
