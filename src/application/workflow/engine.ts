/**
 * Core workflow orchestrator — validates state transitions, manages ticket
 * lifecycle, and resolves inter-ticket dependencies.
 *
 * Uses dynamic topology from workflow templates rather than hardcoded state machines.
 */
import type {
  WorkflowTicket,
  WorkflowTicketId,
  WorkflowState,
  TransitionActor,
  TrackId,
  SessionProvider,
} from '@foundation/types.js';
import type {
  WorkflowTicketRepository,
  WorkflowTransitionRepository,
  TicketDependencyRepository,
} from './ticket-repository.js';
import type { TopologyLoader } from './topology-loader.js';
import type { StageDefinition } from './types.js';
import { isHumanGate, isTerminal, getStageDefinition } from './types.js';
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

  /** Create a new epic (starts in entry state) */
  createEpic(data: {
    title: string;
    description: string;
    trackId?: TrackId;
    provider?: SessionProvider;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    workflowTemplateRowId?: string;
  }): WorkflowTicket;

  /** Create a child task under an epic */
  createTask(data: {
    title: string;
    description: string;
    parentId: WorkflowTicketId;
    provider?: SessionProvider;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    dependsOn?: WorkflowTicketId[];
    workflowTemplateRowId?: string;
  }): WorkflowTicket;

  /** Create an epic that starts directly at plan-review with a pre-written plan */
  createEpicAtPlanReview(data: {
    title: string;
    description: string;
    planDraft: string;
    trackId?: TrackId;
    provider?: SessionProvider;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    workflowTemplateRowId?: string;
  }): WorkflowTicket;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface WorkflowEngineDeps {
  tickets: WorkflowTicketRepository;
  transitions: WorkflowTransitionRepository;
  dependencies: TicketDependencyRepository;
  topologyLoader: TopologyLoader;
  /** Called when an epic advances to a new state (e.g., all tasks done) */
  onEpicAdvanced?: (ticket: WorkflowTicket) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Max recursion depth for auto-transitions to prevent infinite loops */
const MAX_AUTO_TRANSITION_DEPTH = 10;

/** Max times an agent loop can repeat before escalating to human review */
const MAX_AGENT_ITERATIONS = 3;

export function createWorkflowEngine(deps: WorkflowEngineDeps): WorkflowEngine {
  const { tickets, transitions, dependencies, topologyLoader } = deps;
  const resolver: DependencyResolver = createDependencyResolver({ tickets, dependencies, topologyLoader });

  function requireTicket(id: WorkflowTicketId): WorkflowTicket {
    const ticket = tickets.findById(id);
    if (!ticket) throw new Error(`Ticket not found: ${id}`);
    return ticket;
  }

  /**
   * Validate that a transition from the current state to toState is allowed.
   * Returns the transition definition if valid, throws otherwise.
   */
  function validateTransition(
    stages: StageDefinition[],
    ticket: WorkflowTicket,
    toState: WorkflowState,
  ): { to: string; trigger: string; condition?: string } {
    const currentStage = getStageDefinition(stages, ticket.state);
    if (!currentStage) {
      throw new Error(
        `Invalid state: ${ticket.type}:${ticket.state} not found in template`,
      );
    }

    const transition = currentStage.validTransitions.find((t) => t.to === toState);
    if (!transition) {
      const validTargets = currentStage.validTransitions.map((t) => t.to).join(', ');
      throw new Error(
        `Invalid transition: ${ticket.type} cannot go from '${ticket.state}' to '${toState}'. ` +
        `Valid targets: ${validTargets || 'none'}`,
      );
    }

    return transition;
  }

  /**
   * Find the nearest human gate state from the current stage.
   * Used by the circuit breaker to escalate stuck agent loops.
   */
  function findNearestHumanGate(stages: StageDefinition[], fromState: string): string | null {
    const stage = getStageDefinition(stages, fromState);
    if (!stage) return null;

    for (const t of stage.validTransitions) {
      const targetStage = getStageDefinition(stages, t.to);
      if (targetStage?.humanGate) {
        return t.to;
      }
    }
    return null;
  }

  /**
   * Apply a state transition with validation, circuit breaker, and auto-transitions.
   */
  function applyTransition(
    ticket: WorkflowTicket,
    toState: WorkflowState,
    actor: TransitionActor,
    comment?: string,
    data?: Record<string, unknown>,
    _depth: number = 0,
  ): WorkflowTicket {
    // Load topology for this ticket
    const stages = topologyLoader.loadForTicket(ticket);
    const stateData = (ticket.stateData || {}) as Record<string, unknown>;

    // Circuit breaker: check for agent loops exceeding max iterations
    const iteration = (typeof stateData.iteration === 'number' ? stateData.iteration : 0) + 1;
    const currentStage = getStageDefinition(stages, ticket.state);

    if (currentStage?.agentActionable && iteration >= MAX_AGENT_ITERATIONS) {
      // Look for a human gate to escalate to
      const humanGate = findNearestHumanGate(stages, ticket.state);
      if (humanGate && humanGate !== toState) {
        console.warn(
          `[workflow-circuit-breaker] Ticket ${ticket.id} hit ${iteration} iterations at ${ticket.state}. ` +
          `Escalating to ${humanGate} for human intervention.`,
        );
        toState = humanGate as WorkflowState;
        comment = `Circuit breaker: agent loop hit ${iteration} iterations. Escalating to human review.`;
      }
    }

    // Validate the transition
    validateTransition(stages, ticket, toState);

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
      ? { ...stateData, ...data }
      : undefined;
    const updated = tickets.update(ticket.id, {
      state: toState,
      stateChangedAt: now,
      ...(mergedStateData && { stateData: mergedStateData }),
    });

    if (!updated) throw new Error(`Failed to update ticket: ${ticket.id}`);

    // Process auto-transitions if within depth limit
    if (_depth < MAX_AUTO_TRANSITION_DEPTH) {
      const newStage = getStageDefinition(stages, updated.state);
      if (newStage) {
        const autoTarget = newStage.validTransitions.find((t) => t.trigger === 'auto');
        if (autoTarget) {
          const autoActor: TransitionActor = { type: 'system', reason: `Auto-transition from ${updated.state}` };
          return applyTransition(updated, autoTarget.to, autoActor, undefined, undefined, _depth + 1);
        }
      }
    }

    return updated;
  }

  /**
   * Get the entry state (first stage) from a template.
   */
  function getEntryState(stages: StageDefinition[]): string {
    // Entry state is the first one with semanticRole === 'entry', or just the first stage
    const entryStage = stages.find((s) => s.semanticRole === 'entry') ?? stages[0];
    return entryStage.state;
  }

  /**
   * Find a state that has a transition with the given trigger.
   */
  function findStateWithTrigger(stages: StageDefinition[], trigger: string): string | null {
    for (const stage of stages) {
      if (stage.validTransitions.some((t) => t.trigger === trigger)) {
        return stage.state;
      }
    }
    return null;
  }

  /**
   * Resolve the task template row ID from a parent epic.
   */
  function resolveTaskTemplate(parentId: WorkflowTicketId): string | undefined {
    const parent = tickets.findById(parentId);
    if (!parent?.workflowTemplateRowId) return undefined;

    const parentTemplate = topologyLoader.loadTemplateForTicket(parent);
    if (!parentTemplate) return undefined;

    // TODO: In Phase 4, we may have linked task templates; for now return undefined
    // so tasks without explicit template fall back to legacy behavior
    return undefined;
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
      const stages = topologyLoader.loadForTicket(ticket);

      if (!isHumanGate(stages, ticket.state)) {
        throw new Error(`Ticket '${ticket.id}' is not at a human gate (state: ${ticket.state})`);
      }

      const stage = getStageDefinition(stages, ticket.state);
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
      const stages = topologyLoader.loadForTicket(ticket);

      if (!isHumanGate(stages, ticket.state)) {
        throw new Error(`Ticket '${ticket.id}' is not at a human gate (state: ${ticket.state})`);
      }

      const stage = getStageDefinition(stages, ticket.state);
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
      if (ticket.type !== 'task') return;

      // Check if task is in a terminal state
      const stages = topologyLoader.loadForTicket(ticket);
      if (!isTerminal(stages, ticket.state)) return;

      // Resolve dependencies that depended on this task
      const unblockedIds = resolver.resolveAndUnblock(ticketId);

      // Auto-transition unblocked tickets via their 'all-deps-resolved' trigger
      const systemActor: TransitionActor = { type: 'system', reason: 'All dependencies resolved' };
      for (const unblockedId of unblockedIds) {
        const blocked = tickets.findById(unblockedId);
        if (!blocked) continue;

        try {
          const blockedStages = topologyLoader.loadForTicket(blocked);
          const blockedStage = getStageDefinition(blockedStages, blocked.state);
          const unblockTransition = blockedStage?.validTransitions.find(
            (t) => t.trigger === 'all-deps-resolved',
          );
          if (unblockTransition) {
            applyTransition(blocked, unblockTransition.to, systemActor);
          }
        } catch (err) {
          console.warn(`Failed to unblock ticket ${unblockedId}:`, err);
        }
      }

      // Check if parent epic should advance
      if (ticket.parentId) {
        const epic = tickets.findById(ticket.parentId);
        if (epic && epic.type === 'epic') {
          try {
            const epicStages = topologyLoader.loadForTicket(epic);
            const epicStage = getStageDefinition(epicStages, epic.state);
            const allDoneTransition = epicStage?.validTransitions.find(
              (t) => t.trigger === 'all-tasks-done',
            );

            if (allDoneTransition && resolver.allChildrenDone(epic.id)) {
              const epicActor: TransitionActor = {
                type: 'system',
                reason: 'All child tasks completed',
              };
              const advancedEpic = applyTransition(epic, allDoneTransition.to, epicActor);
              // Notify callback (B4 fix)
              deps.onEpicAdvanced?.(advancedEpic);
            }
          } catch (err) {
            console.warn(`Failed to advance epic ${epic.id}:`, err);
          }
        }
      }
    },

    createEpic(data): WorkflowTicket {
      // Determine initial state from template
      let initialState: WorkflowState = 'idea';

      if (data.workflowTemplateRowId) {
        const stages = topologyLoader.loadByTemplateRowId(data.workflowTemplateRowId);
        initialState = getEntryState(stages);
      }

      const epic = tickets.create({
        type: 'epic',
        title: data.title,
        description: data.description,
        state: initialState,
        trackId: data.trackId,
        provider: data.provider || 'claude',
        priority: data.priority || 'medium',
        sortOrder: 0,
        workflowTemplateRowId: data.workflowTemplateRowId,
      });

      // Follow auto-transitions from entry state
      if (data.workflowTemplateRowId) {
        const stages = topologyLoader.loadByTemplateRowId(data.workflowTemplateRowId);
        const entryStage = getStageDefinition(stages, epic.state);
        const autoTarget = entryStage?.validTransitions.find((t) => t.trigger === 'auto');
        if (autoTarget) {
          const actor: TransitionActor = { type: 'system', reason: 'Auto-transition from entry state' };
          return applyTransition(epic, autoTarget.to, actor);
        }
      }

      return epic;
    },

    createTask(data): WorkflowTicket {
      const hasDeps = data.dependsOn && data.dependsOn.length > 0;
      let initialState: WorkflowState = hasDeps ? 'blocked' : 'ready';

      // Resolve task template from parent if not provided
      const templateRowId = data.workflowTemplateRowId ?? resolveTaskTemplate(data.parentId);

      if (templateRowId) {
        try {
          const stages = topologyLoader.loadByTemplateRowId(templateRowId);
          if (hasDeps) {
            // Find the state with 'all-deps-resolved' trigger (the blocked state)
            const blockedState = findStateWithTrigger(stages, 'all-deps-resolved');
            if (blockedState) initialState = blockedState;
          } else {
            // Use entry state
            initialState = getEntryState(stages);
          }
        } catch {
          // Template not found, use defaults
        }
      }

      const task = tickets.create({
        type: 'task',
        title: data.title,
        description: data.description,
        state: initialState,
        parentId: data.parentId,
        provider: data.provider || 'claude',
        priority: data.priority || 'medium',
        sortOrder: 0,
        workflowTemplateRowId: templateRowId,
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
      // Find the human gate state to start at
      let planReviewState: WorkflowState = 'plan-review';

      if (data.workflowTemplateRowId) {
        const stages = topologyLoader.loadByTemplateRowId(data.workflowTemplateRowId);
        // Find first human gate with semanticRole 'human-gate'
        const humanGateStage = stages.find((s) => s.humanGate && s.semanticRole === 'human-gate');
        if (humanGateStage) {
          planReviewState = humanGateStage.state;
        }
      }

      const epic = tickets.create({
        type: 'epic',
        title: data.title,
        description: data.description,
        state: planReviewState,
        trackId: data.trackId,
        provider: data.provider || 'claude',
        priority: data.priority || 'medium',
        sortOrder: 0,
        stateData: { planDraft: data.planDraft },
        workflowTemplateRowId: data.workflowTemplateRowId,
      });

      // Synthetic audit trail showing this epic was fast-tracked
      transitions.create({
        ticketId: epic.id,
        fromState: 'idea',
        toState: planReviewState,
        actor: { type: 'human' },
        comment: 'Epic created directly at plan-review with pre-written plan',
      });

      return epic;
    },
  };
}
