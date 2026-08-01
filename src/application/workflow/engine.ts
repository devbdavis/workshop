/**
 * Core workflow orchestrator — validates state transitions, manages ticket
 * lifecycle, and resolves inter-ticket dependencies.
 *
 * Uses dynamic topology from workflow playbooks rather than hardcoded state machines.
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
} from '@domain/workflow/ticket-repository.js';
import type { TopologyLoader } from './topology-loader.js';
import type { PlaybookRepository } from '@domain/workflow/playbook-repository.js';
import type { StageDefinition } from '@domain/workflow/types.js';
import { isHumanGate, isTerminal, getStageDefinition } from '@domain/workflow/types.js';
import { createDependencyResolver } from './dependency-resolver.js';
import type { DependencyResolver } from './dependency-resolver.js';
import { isAutonomous, DEFAULT_AUTONOMOUS_BUDGET, type AutonomousBudget } from './autonomy.js';

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

  /** Approve a ticket at a human gate. Actor defaults to human; Dark Factory passes a system actor. */
  approve(ticketId: WorkflowTicketId, comment?: string, actor?: TransitionActor): WorkflowTicket;

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
    playbookRowId?: string;
  }): WorkflowTicket;

  /** Create a child task under an epic */
  createTask(data: {
    title: string;
    description: string;
    parentId: WorkflowTicketId;
    provider?: SessionProvider;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    dependsOn?: WorkflowTicketId[];
    playbookRowId?: string;
  }): WorkflowTicket;

  /** Create an epic that starts directly at plan-review with a pre-written plan */
  createEpicAtPlanReview(data: {
    title: string;
    description: string;
    planDraft: string;
    trackId?: TrackId;
    provider?: SessionProvider;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    playbookRowId?: string;
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
  /** Playbook repository for resolving companion task playbooks */
  playbooks?: PlaybookRepository;
  /** Called when an epic advances to a new state (e.g., all tasks done) */
  onEpicAdvanced?: (ticket: WorkflowTicket) => Promise<void>;
  /** Called when a blocked task becomes unblocked and transitions to its ready state */
  onTaskUnblocked?: (ticket: WorkflowTicket) => Promise<void>;
  /** Called when any ticket transitions into a terminal state (zero outgoing transitions). */
  onTerminalState?: (ticket: WorkflowTicket) => Promise<void>;
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

  /** Resolve the whole-ticket autonomy budget from the ticket itself, or its parent epic. */
  function resolveBudget(ticket: WorkflowTicket): AutonomousBudget {
    const epicStateData = ticket.parentId
      ? ((tickets.findById(ticket.parentId)?.stateData || {}) as Record<string, unknown>)
      : ((ticket.stateData || {}) as Record<string, unknown>);
    const budget = epicStateData.autonomousBudget as AutonomousBudget | undefined;
    return budget ?? DEFAULT_AUTONOMOUS_BUDGET;
  }

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
        `Invalid state: ${ticket.type}:${ticket.state} not found in playbook`,
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

    let circuitBreakerEscalated = false;
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
        circuitBreakerEscalated = true;
      }
    }

    // Dark Factory: step/budget tracking, guarded so non-autonomous tickets are unaffected
    let autonomousStateData: Record<string, unknown> | undefined;
    if (isAutonomous(ticket, tickets)) {
      const stepCount = (typeof stateData.stepCount === 'number' ? stateData.stepCount : 0) + 1;
      autonomousStateData = { stepCount };

      if (circuitBreakerEscalated) {
        autonomousStateData.needsHuman = true;
      } else {
        const budget = resolveBudget(ticket);
        const elapsedMs = Date.now() - Date.parse(ticket.createdAt);
        if (stepCount >= budget.maxSteps || elapsedMs >= budget.maxWallClockMs) {
          // Flag for human review regardless of whether we redirect toState — if the
          // natural transition already lands on the gate, needsHuman must still be set
          // so autoAdvanceGates refuses to wave it through.
          autonomousStateData.needsHuman = true;
          comment = 'Dark Factory: budget exhausted (steps/wall-clock), escalating to human review.';
          const humanGate = findNearestHumanGate(stages, ticket.state);
          if (humanGate && humanGate !== toState) {
            toState = humanGate as WorkflowState;
          }
        }
      }
    }

    // Validate the transition
    validateTransition(stages, ticket, toState);

    // Guard: epics transitioning to a terminal state must have all children done or cancelled
    const targetStage = getStageDefinition(stages, toState);
    if (ticket.type === 'epic' && targetStage?.semanticRole === 'terminal' && toState !== 'cancelled') {
      const children = tickets.findChildren(ticket.id);
      if (children.length > 0) {
        const nonTerminal = children.filter((c) => {
          try {
            const childStages = topologyLoader.loadForTicket(c);
            return !isTerminal(childStages, c.state);
          } catch {
            // No playbook — use legacy check
            return !['done', 'cancelled', 'merged'].includes(c.state);
          }
        });
        if (nonTerminal.length > 0) {
          const summary = nonTerminal.map((c) => `${c.title.slice(0, 40)} (${c.state})`).join(', ');
          throw new Error(
            `Cannot close epic: ${nonTerminal.length} child task(s) not in terminal state: ${summary}`,
          );
        }
      }
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

    // Update ticket state, merging transition data (and Dark Factory bookkeeping) into stateData
    const mergedStateData = (data || autonomousStateData)
      ? { ...stateData, ...data, ...autonomousStateData }
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

    // Terminal-state hook — fire when ticket reaches a state with no outgoing transitions
    const finalStage = getStageDefinition(stages, updated.state);
    if (finalStage && finalStage.validTransitions.length === 0) {
      deps.onTerminalState?.(updated)?.catch((err) => {
        console.warn(`[workflow] Terminal-state hook failed for ticket ${updated.id}:`, err);
      });
    }

    return updated;
  }

  /**
   * Get the entry state (first stage) from a playbook.
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
   * Resolve the task playbook row ID from a parent epic.
   */
  function resolveTaskPlaybook(parentId: WorkflowTicketId): string | undefined {
    const parent = tickets.findById(parentId);
    if (!parent?.playbookRowId) return undefined;

    const parentPlaybook = topologyLoader.loadPlaybookForTicket(parent);
    if (!parentPlaybook) return undefined;

    // Find companion task playbook whose parentPlaybookId matches the epic playbook's id
    if (deps.playbooks) {
      const taskPlaybook = deps.playbooks.findTaskPlaybookByParent(parentPlaybook.id);
      if (taskPlaybook) return taskPlaybook.rowId;
    }

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

    approve(ticketId: WorkflowTicketId, comment?: string, actor: TransitionActor = { type: 'human' }): WorkflowTicket {
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

      // Approval resolves any pending Dark Factory escalation (only touch stateData if it was set)
      const stateData = (ticket.stateData || {}) as Record<string, unknown>;
      const clearEscalation = stateData.needsHuman === true ? { needsHuman: false } : undefined;
      return applyTransition(ticket, approvalTarget.to, actor, comment, clearEscalation);
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
      // Human rejection resolves any pending Dark Factory escalation (only touch stateData if it was set)
      const stateData = (ticket.stateData || {}) as Record<string, unknown>;
      const clearEscalation = stateData.needsHuman === true ? { needsHuman: false } : undefined;
      return applyTransition(ticket, rejectTarget.to, actor, comment, clearEscalation);
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
            const unblocked = applyTransition(blocked, unblockTransition.to, systemActor);
            // Dispatch agents for the newly unblocked task
            deps.onTaskUnblocked?.(unblocked);
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
      // Determine initial state from playbook
      let initialState: WorkflowState = 'idea';

      if (data.playbookRowId) {
        const stages = topologyLoader.loadByPlaybookRowId(data.playbookRowId);
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
        playbookRowId: data.playbookRowId,
      });

      // Follow auto-transitions from entry state
      // Try to load topology even without explicit playbook (for backward compat with tests)
      try {
        const stages = data.playbookRowId
          ? topologyLoader.loadByPlaybookRowId(data.playbookRowId)
          : topologyLoader.loadForTicket(epic);
        const entryStage = getStageDefinition(stages, epic.state);
        const autoTarget = entryStage?.validTransitions.find((t) => t.trigger === 'auto');
        if (autoTarget) {
          const actor: TransitionActor = { type: 'system', reason: 'Auto-transition from entry state' };
          return applyTransition(epic, autoTarget.to, actor);
        }
      } catch {
        // No topology available - skip auto-transitions (ticket stays in initial state)
      }

      return epic;
    },

    createTask(data): WorkflowTicket {
      const hasDeps = data.dependsOn && data.dependsOn.length > 0;
      let initialState: WorkflowState = hasDeps ? 'blocked' : 'ready';

      // Resolve task playbook from parent if not provided
      const playbookRowId = data.playbookRowId ?? resolveTaskPlaybook(data.parentId);

      if (playbookRowId) {
        try {
          const stages = topologyLoader.loadByPlaybookRowId(playbookRowId);
          if (hasDeps) {
            // Find the state with 'all-deps-resolved' trigger (the blocked state)
            const blockedState = findStateWithTrigger(stages, 'all-deps-resolved');
            if (blockedState) initialState = blockedState;
          } else {
            // Use entry state
            initialState = getEntryState(stages);
          }
        } catch {
          // Playbook not found, use defaults
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
        playbookRowId: playbookRowId,
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

      if (data.playbookRowId) {
        const stages = topologyLoader.loadByPlaybookRowId(data.playbookRowId);
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
        playbookRowId: data.playbookRowId,
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
