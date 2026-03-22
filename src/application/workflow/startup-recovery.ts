/**
 * Startup recovery for workflow tickets — detects agent-actionable tickets
 * whose dispatched sessions have died, and re-dispatches them.
 *
 * This runs once on server startup (after a short delay to let session sync
 * complete) and can also be invoked on-demand.
 */
import type { WorkflowTicket, SessionId } from '@foundation/types.js';
import type { WorkflowTicketRepository } from './ticket-repository.js';
import type { SessionRepository } from '@domain/session/repository';
import type { DispatchCoordinator } from './dispatch-coordinator.js';
import type { TopologyLoader } from './topology-loader.js';
import {
  isTerminal as topologyIsTerminal,
  isAgentActionable as topologyIsAgentActionable,
  getStageDefinition,
} from './types.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface WorkflowRecoveryResult {
  scanned: number;
  redispatched: string[];
  skipped: string[];
  errors: Array<{ ticketId: string; error: string }>;
}

export interface WorkflowRecoveryDeps {
  tickets: WorkflowTicketRepository;
  sessions: SessionRepository;
  dispatcher: DispatchCoordinator;
  topologyLoader: TopologyLoader;
}

// ---------------------------------------------------------------------------
// Helpers — topology-aware state checks with fallbacks for legacy tickets
// ---------------------------------------------------------------------------

function checkIsTerminal(deps: WorkflowRecoveryDeps, ticket: WorkflowTicket): boolean {
  try {
    if (ticket.workflowTemplateRowId) {
      const stages = deps.topologyLoader.loadByTemplateRowId(ticket.workflowTemplateRowId);
      return topologyIsTerminal(stages, ticket.state);
    }
  } catch { /* fall through */ }
  return ['done', 'cancelled', 'merged'].includes(ticket.state);
}

function checkIsAgentActionable(deps: WorkflowRecoveryDeps, ticket: WorkflowTicket): boolean {
  try {
    if (ticket.workflowTemplateRowId) {
      const stages = deps.topologyLoader.loadByTemplateRowId(ticket.workflowTemplateRowId);
      return topologyIsAgentActionable(stages, ticket.state);
    }
  } catch { /* fall through */ }
  // Fallback for tickets without templates
  const agentStates: Record<string, string[]> = {
    epic: ['triaging', 'planning', 'plan-critique', 'splitting', 'integration-review', 'integration-fix'],
    task: ['ready', 'in-progress', 'code-review', 'changes-requested'],
  };
  return agentStates[ticket.type]?.includes(ticket.state) ?? false;
}

function checkIsExecutionStage(deps: WorkflowRecoveryDeps, ticket: WorkflowTicket): boolean {
  try {
    if (ticket.workflowTemplateRowId) {
      const stages = deps.topologyLoader.loadByTemplateRowId(ticket.workflowTemplateRowId);
      const stage = getStageDefinition(stages, ticket.state);
      return stage?.validTransitions.some(
        (t) => t.trigger === 'execution-complete' || t.trigger === 'execution-failed',
      ) ?? false;
    }
  } catch { /* fall through */ }
  // Fallback for tickets without templates
  return ticket.state === 'executing';
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Scan all non-terminal workflow tickets for ones that are in agent-actionable
 * states but have no live sessions. Re-dispatch those.
 */
export async function recoverStuckTickets(
  deps: WorkflowRecoveryDeps,
): Promise<WorkflowRecoveryResult> {
  const { tickets, sessions } = deps;
  const result: WorkflowRecoveryResult = {
    scanned: 0,
    redispatched: [],
    skipped: [],
    errors: [],
  };

  // Get all tickets — filter to non-terminal, agent-actionable states
  const allTickets = tickets.findAll();
  const candidates = allTickets.filter(
    (t) =>
      !checkIsTerminal(deps, t) &&
      checkIsAgentActionable(deps, t) &&
      !checkIsExecutionStage(deps, t), // execution stages are handled by ExecutionDispatcher
  );

  result.scanned = candidates.length;

  for (const ticket of candidates) {
    const sessionIds = getDispatchedSessionIds(ticket);

    if (sessionIds.length === 0) {
      // Never dispatched or sessions list was cleared — re-dispatch
      await redispatch(ticket, 'no session IDs recorded', deps, result);
      continue;
    }

    // Check if any dispatched session is still alive
    const hasLiveSession = sessionIds.some((sid) => {
      const session = sessions.findById(sid as SessionId);
      return session && session.state === 'active';
    });

    if (!hasLiveSession) {
      await redispatch(ticket, 'all dispatched sessions are dead/missing', deps, result);
    } else {
      result.skipped.push(ticket.id);
    }
  }

  return result;
}

function getDispatchedSessionIds(ticket: WorkflowTicket): string[] {
  const stateData = ticket.stateData as Record<string, unknown> | undefined;
  if (!stateData) return [];

  const ids = stateData.agentSessionIds;
  if (Array.isArray(ids)) return ids as string[];

  // Also check executionSessionId for executing state
  if (ticket.executionSessionId) return [ticket.executionSessionId];

  return [];
}

async function redispatch(
  ticket: WorkflowTicket,
  reason: string,
  deps: WorkflowRecoveryDeps,
  result: WorkflowRecoveryResult,
): Promise<void> {
  try {
    console.log(
      `[workflow-recovery] Re-dispatching ticket ${ticket.id} (${ticket.type}:${ticket.state}) — ${reason}`,
    );
    await deps.dispatcher.dispatchForCurrentState(ticket.id);
    result.redispatched.push(ticket.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[workflow-recovery] Failed to re-dispatch ${ticket.id}: ${message}`);
    result.errors.push({ ticketId: ticket.id, error: message });
  }
}
