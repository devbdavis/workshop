/**
 * Core workflow orchestrator — validates state transitions, manages ticket
 * lifecycle, and resolves inter-ticket dependencies.
 */
import type {
  WorkflowTicket,
  WorkflowTicketId,
  WorkflowState,
  TransitionActor,
  TrackId,
  SessionProvider,
} from '@foundation/types';
import type {
  WorkflowTicketRepository,
  WorkflowTransitionRepository,
  TicketDependencyRepository,
} from '@domain/workflow/repository';
import { isValidTransition, isHumanGate, getStageDefinition } from '@domain/workflow/state-machine.js';
import { createDependencyResolver } from './dependency-resolver.js';
import type { DependencyResolver } from './dependency-resolver.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface WorkflowEngine {
  /** Transition a ticket to a new state with validation */
  transition(
    ticketId: WorkflowTicketId,
    toState: WorkflowState,
    actor: TransitionActor,
    comment?: string,
    data?: Record<string, unknown>,
  ): WorkflowTicket;

  /** Human approves a ticket at a human gate */
  approve(ticketId: WorkflowTicketId, comment?: string): WorkflowTicket;

  /** Human rejects a ticket at a human gate */
  reject(ticketId: WorkflowTicketId, comment?: string): WorkflowTicket;

  /** Called when a task completes — resolves deps and checks epic progress */
  onTaskCompleted(ticketId: WorkflowTicketId): void;

  /** Create a new epic (starts in 'idea' state) */
  createEpic(data: {
    title: string;
    description: string;
    trackId?: TrackId;
    provider?: SessionProvider;
    priority?: 'low' | 'medium' | 'high' | 'critical';
  }): WorkflowTicket;

  /** Create a child task under an epic */
  createTask(data: {
    title: string;
    description: string;
    parentId: WorkflowTicketId;
    provider?: SessionProvider;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    dependsOn?: WorkflowTicketId[];
  }): WorkflowTicket;

  /** Create an epic that starts directly at plan-review with a pre-written plan */
  createEpicAtPlanReview(data: {
    title: string;
    description: string;
    planDraft: string;
    trackId?: TrackId;
    provider?: SessionProvider;
    priority?: 'low' | 'medium' | 'high' | 'critical';
  }): WorkflowTicket;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface WorkflowEngineDeps {
  tickets: WorkflowTicketRepository;
  transitions: WorkflowTransitionRepository;
  dependencies: TicketDependencyRepository;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createWorkflowEngine(deps: WorkflowEngineDeps): WorkflowEngine {
  const { tickets, transitions, dependencies } = deps;
  const resolver: DependencyResolver = createDependencyResolver({ tickets, dependencies });

  function requireTicket(id: WorkflowTicketId): WorkflowTicket {
    const ticket = tickets.findById(id);
    if (!ticket) throw new Error(`Ticket not found: ${id}`);
    return ticket;
  }

  /** Max times plan-critique can send a ticket back to planning before escalating to human review */
  const MAX_CRITIQUE_ITERATIONS = 3;

  function applyTransition(
    ticket: WorkflowTicket,
    toState: WorkflowState,
    actor: TransitionActor,
    comment?: string,
    data?: Record<string, unknown>,
  ): WorkflowTicket {
    // Circuit breaker: if plan-critique → planning loop exceeds max iterations,
    // redirect to plan-review (human gate) so a human can intervene
    if (ticket.state === 'plan-critique' && toState === 'planning') {
      const stateData = (ticket.stateData || {}) as Record<string, unknown>;
      const iteration = (typeof stateData.iteration === 'number' ? stateData.iteration : 0) + 1;
      if (iteration >= MAX_CRITIQUE_ITERATIONS) {
        console.warn(
          `[workflow-circuit-breaker] Ticket ${ticket.id} hit ${iteration} plan-critique iterations. Escalating to plan-review for human intervention.`,
        );
        toState = 'plan-review' as WorkflowState;
        comment = `Circuit breaker: plan-critique ↔ planning loop hit ${iteration} iterations. Escalating to human review. Original blocking findings are in stateData.findings.`;
      }
    }

    if (!isValidTransition(ticket.type, ticket.state, toState)) {
      throw new Error(
        `Invalid transition: ${ticket.type} cannot go from '${ticket.state}' to '${toState}'`,
      );
    }

    const now = new Date().toISOString();

    // Create audit record
    transitions.create({
      ticketId: ticket.id,
      fromState: ticket.state,
      toState,
      actor,
      comment,
      data,
    });

    // Update ticket state, merging transition data into stateData
    const mergedStateData = data
      ? { ...(ticket.stateData as Record<string, unknown> || {}), ...data }
      : undefined;
    const updated = tickets.update(ticket.id, {
      state: toState,
      stateChangedAt: now,
      ...(mergedStateData && { stateData: mergedStateData }),
    });

    if (!updated) throw new Error(`Failed to update ticket: ${ticket.id}`);

    // Process auto-transitions: if the new state has an 'auto' trigger, follow it immediately
    const stage = getStageDefinition(updated.type, updated.state);
    if (stage) {
      const autoTarget = stage.validTransitions.find((t) => t.trigger === 'auto');
      if (autoTarget) {
        const autoActor: TransitionActor = { type: 'system', reason: `Auto-transition from ${updated.state}` };
        return applyTransition(updated, autoTarget.to, autoActor);
      }
    }

    return updated;
  }

  return {
    transition(
      ticketId: WorkflowTicketId,
      toState: WorkflowState,
      actor: TransitionActor,
      comment?: string,
      data?: Record<string, unknown>,
    ): WorkflowTicket {
      const ticket = requireTicket(ticketId);
      return applyTransition(ticket, toState, actor, comment, data);
    },

    approve(ticketId: WorkflowTicketId, comment?: string): WorkflowTicket {
      const ticket = requireTicket(ticketId);

      if (!isHumanGate(ticket.state)) {
        throw new Error(`Ticket '${ticket.id}' is not at a human gate (state: ${ticket.state})`);
      }

      // Find the approval transition target from the stage definition
      const stage = getStageDefinition(ticket.type, ticket.state);
      if (!stage) throw new Error(`No stage definition for ${ticket.type}:${ticket.state}`);

      const approvalTarget = stage.validTransitions.find((t) => t.trigger === 'human-approve');
      if (!approvalTarget) {
        throw new Error(`No approval transition defined for state '${ticket.state}'`);
      }

      const actor: TransitionActor = { type: 'human' };
      return applyTransition(ticket, approvalTarget.to, actor, comment);
    },

    reject(ticketId: WorkflowTicketId, comment?: string): WorkflowTicket {
      const ticket = requireTicket(ticketId);

      if (!isHumanGate(ticket.state)) {
        throw new Error(`Ticket '${ticket.id}' is not at a human gate (state: ${ticket.state})`);
      }

      const stage = getStageDefinition(ticket.type, ticket.state);
      if (!stage) throw new Error(`No stage definition for ${ticket.type}:${ticket.state}`);

      const rejectTarget = stage.validTransitions.find((t) => t.trigger === 'human-reject');
      if (!rejectTarget) {
        throw new Error(`No rejection transition defined for state '${ticket.state}'`);
      }

      const actor: TransitionActor = { type: 'human' };
      return applyTransition(ticket, rejectTarget.to, actor, comment);
    },

    onTaskCompleted(ticketId: WorkflowTicketId): void {
      const ticket = requireTicket(ticketId);
      if (ticket.type !== 'task' || ticket.state !== 'done') return;

      // Resolve dependencies that depended on this task
      const unblockedIds = resolver.resolveAndUnblock(ticketId);

      // Auto-transition unblocked tickets from 'blocked' to 'ready'
      const systemActor: TransitionActor = { type: 'system', reason: 'All dependencies resolved' };
      for (const unblockedId of unblockedIds) {
        const blocked = tickets.findById(unblockedId);
        if (blocked && blocked.state === 'blocked') {
          applyTransition(blocked, 'ready', systemActor);
        }
      }

      // Check if parent epic should advance
      if (ticket.parentId) {
        const epic = tickets.findById(ticket.parentId);
        if (epic && epic.type === 'epic' && epic.state === 'in-progress') {
          if (resolver.allChildrenDone(epic.id)) {
            const epicActor: TransitionActor = {
              type: 'system',
              reason: 'All child tasks completed',
            };
            applyTransition(epic, 'integration-review', epicActor);
          }
        }
      }
    },

    createEpic(data): WorkflowTicket {
      const epic = tickets.create({
        type: 'epic',
        title: data.title,
        description: data.description,
        state: 'idea',
        trackId: data.trackId,
        provider: data.provider || 'claude',
        priority: data.priority || 'medium',
        sortOrder: 0,
      });

      // Auto-transition from 'idea' to 'triaging'
      const actor: TransitionActor = { type: 'system', reason: 'Auto-triage on creation' };
      return applyTransition(epic, 'triaging', actor);
    },

    createTask(data): WorkflowTicket {
      const hasDeps = data.dependsOn && data.dependsOn.length > 0;
      const initialState: WorkflowState = hasDeps ? 'blocked' : 'ready';

      const task = tickets.create({
        type: 'task',
        title: data.title,
        description: data.description,
        state: initialState,
        parentId: data.parentId,
        provider: data.provider || 'claude',
        priority: data.priority || 'medium',
        sortOrder: 0,
      });

      // Create dependency records
      if (data.dependsOn) {
        for (const depId of data.dependsOn) {
          dependencies.create(task.id, depId);
        }
      }

      return task;
    },

    createEpicAtPlanReview(data): WorkflowTicket {
      const epic = tickets.create({
        type: 'epic',
        title: data.title,
        description: data.description,
        state: 'plan-review',
        trackId: data.trackId,
        provider: data.provider || 'claude',
        priority: data.priority || 'medium',
        sortOrder: 0,
        stateData: { planDraft: data.planDraft },
      });

      // Synthetic audit trail showing this epic was fast-tracked
      transitions.create({
        ticketId: epic.id,
        fromState: 'idea',
        toState: 'plan-review',
        actor: { type: 'human' },
        comment: 'Epic created directly at plan-review with pre-written plan',
      });

      return epic;
    },
  };
}
