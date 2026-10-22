/**
 * Core workflow orchestrator — validates state transitions, manages issue
 * lifecycle, and resolves inter-issue dependencies.
 *
 * Uses dynamic topology from workflow playbooks rather than hardcoded state machines.
 */
import type {
  WorkflowIssue,
  WorkflowIssueId,
  WorkflowState,
  TransitionActor,
  TrackId,
  SessionProvider,
} from '@foundation/types.js';
import type {
  WorkflowIssueRepository,
  WorkflowTransitionRepository,
  IssueDependencyRepository,
} from '@domain/workflow/issue-repository.js';
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
  /** Transition an issue to a new state with validation */
  transition(
    issueId: WorkflowIssueId,
    toState: WorkflowState,
    actor: TransitionActor,
    comment?: string,
    data?: Record<string, unknown>,
  ): WorkflowIssue;

  /** Approve an issue at a human gate. Actor defaults to human; Dark Factory passes a system actor. */
  approve(issueId: WorkflowIssueId, comment?: string, actor?: TransitionActor): WorkflowIssue;

  /** Human rejects an issue at a human gate */
  reject(issueId: WorkflowIssueId, comment?: string): WorkflowIssue;

  /** Called when a task completes — resolves deps and checks epic progress */
  onTaskCompleted(issueId: WorkflowIssueId): void;

  /** Create a new epic (starts in entry state) */
  createEpic(data: {
    title: string;
    description: string;
    trackId?: TrackId;
    provider?: SessionProvider;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    playbookRowId?: string;
  }): WorkflowIssue;

  /** Create a child task under an epic */
  createTask(data: {
    title: string;
    description: string;
    parentId: WorkflowIssueId;
    provider?: SessionProvider;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    dependsOn?: WorkflowIssueId[];
    playbookRowId?: string;
  }): WorkflowIssue;

  /** Create an epic that starts directly at plan-review with a pre-written plan */
  createEpicAtPlanReview(data: {
    title: string;
    description: string;
    planDraft: string;
    trackId?: TrackId;
    provider?: SessionProvider;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    playbookRowId?: string;
  }): WorkflowIssue;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface WorkflowEngineDeps {
  issues: WorkflowIssueRepository;
  transitions: WorkflowTransitionRepository;
  dependencies: IssueDependencyRepository;
  topologyLoader: TopologyLoader;
  /** Playbook repository for resolving companion task playbooks */
  playbooks?: PlaybookRepository;
  /** Called when an epic advances to a new state (e.g., all tasks done) */
  onEpicAdvanced?: (issue: WorkflowIssue) => Promise<void>;
  /** Called when a blocked task becomes unblocked and transitions to its ready state */
  onTaskUnblocked?: (issue: WorkflowIssue) => Promise<void>;
  /** Called when any issue transitions into a terminal state (zero outgoing transitions). */
  onTerminalState?: (issue: WorkflowIssue) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Max recursion depth for auto-transitions to prevent infinite loops */
const MAX_AUTO_TRANSITION_DEPTH = 10;

/** Max times an agent loop can repeat before escalating to human review */
const MAX_AGENT_ITERATIONS = 3;

export function createWorkflowEngine(deps: WorkflowEngineDeps): WorkflowEngine {
  const { issues, transitions, dependencies, topologyLoader } = deps;
  const resolver: DependencyResolver = createDependencyResolver({ issues, dependencies, topologyLoader });

  /** Resolve the whole-issue autonomy budget from the issue itself, or its parent epic. */
  function resolveBudget(issue: WorkflowIssue): AutonomousBudget {
    const epicStateData = issue.parentId
      ? ((issues.findById(issue.parentId)?.stateData || {}) as Record<string, unknown>)
      : ((issue.stateData || {}) as Record<string, unknown>);
    const budget = epicStateData.autonomousBudget as AutonomousBudget | undefined;
    return budget ?? DEFAULT_AUTONOMOUS_BUDGET;
  }

  function requireIssue(id: WorkflowIssueId): WorkflowIssue {
    const issue = issues.findById(id);
    if (!issue) throw new Error(`Issue not found: ${id}`);
    return issue;
  }

  /**
   * Validate that a transition from the current state to toState is allowed.
   * Returns the transition definition if valid, throws otherwise.
   */
  function validateTransition(
    stages: StageDefinition[],
    issue: WorkflowIssue,
    toState: WorkflowState,
  ): { to: string; trigger: string; condition?: string } {
    const currentStage = getStageDefinition(stages, issue.state);
    if (!currentStage) {
      throw new Error(
        `Invalid state: ${issue.type}:${issue.state} not found in playbook`,
      );
    }

    const transition = currentStage.validTransitions.find((t) => t.to === toState);
    if (!transition) {
      const validTargets = currentStage.validTransitions.map((t) => t.to).join(', ');
      throw new Error(
        `Invalid transition: ${issue.type} cannot go from '${issue.state}' to '${toState}'. ` +
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
    issue: WorkflowIssue,
    toState: WorkflowState,
    actor: TransitionActor,
    comment?: string,
    data?: Record<string, unknown>,
    _depth: number = 0,
  ): WorkflowIssue {
    // Load topology for this issue
    const stages = topologyLoader.loadForIssue(issue);
    const stateData = (issue.stateData || {}) as Record<string, unknown>;

    // Circuit breaker: check for agent loops exceeding max iterations
    const iteration = (typeof stateData.iteration === 'number' ? stateData.iteration : 0) + 1;
    const currentStage = getStageDefinition(stages, issue.state);

    let circuitBreakerEscalated = false;
    if (currentStage?.agentActionable && iteration >= MAX_AGENT_ITERATIONS) {
      // Look for a human gate to escalate to
      const humanGate = findNearestHumanGate(stages, issue.state);
      if (humanGate && humanGate !== toState) {
        console.warn(
          `[workflow-circuit-breaker] Issue ${issue.id} hit ${iteration} iterations at ${issue.state}. ` +
          `Escalating to ${humanGate} for human intervention.`,
        );
        toState = humanGate as WorkflowState;
        comment = `Circuit breaker: agent loop hit ${iteration} iterations. Escalating to human review.`;
        circuitBreakerEscalated = true;
      }
    }

    // Dark Factory: step/budget tracking, guarded so non-autonomous issues are unaffected
    let autonomousStateData: Record<string, unknown> | undefined;
    if (isAutonomous(issue, issues)) {
      const stepCount = (typeof stateData.stepCount === 'number' ? stateData.stepCount : 0) + 1;
      autonomousStateData = { stepCount };

      if (circuitBreakerEscalated) {
        autonomousStateData.needsHuman = true;
      } else {
        const budget = resolveBudget(issue);
        const elapsedMs = Date.now() - Date.parse(issue.createdAt);
        if (stepCount >= budget.maxSteps || elapsedMs >= budget.maxWallClockMs) {
          // Flag for human review regardless of whether we redirect toState — if the
          // natural transition already lands on the gate, needsHuman must still be set
          // so autoAdvanceGates refuses to wave it through.
          autonomousStateData.needsHuman = true;
          comment = 'Dark Factory: budget exhausted (steps/wall-clock), escalating to human review.';
          const humanGate = findNearestHumanGate(stages, issue.state);
          if (humanGate && humanGate !== toState) {
            toState = humanGate as WorkflowState;
          }
        }
      }
    }

    // Validate the transition
    validateTransition(stages, issue, toState);

    // Guard: epics transitioning to a terminal state must have all children done or cancelled
    const targetStage = getStageDefinition(stages, toState);
    if (issue.type === 'epic' && targetStage?.semanticRole === 'terminal' && toState !== 'cancelled') {
      const children = issues.findChildren(issue.id);
      if (children.length > 0) {
        const nonTerminal = children.filter((c) => {
          try {
            const childStages = topologyLoader.loadForIssue(c);
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
      issueId: issue.id,
      fromState: issue.state,
      toState,
      actor,
      comment,
      data,
    });

    // Update issue state, merging transition data (and Dark Factory bookkeeping) into stateData
    const mergedStateData = (data || autonomousStateData)
      ? { ...stateData, ...data, ...autonomousStateData }
      : undefined;
    const updated = issues.update(issue.id, {
      state: toState,
      stateChangedAt: now,
      ...(mergedStateData && { stateData: mergedStateData }),
    });

    if (!updated) throw new Error(`Failed to update issue: ${issue.id}`);

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

    // Terminal-state hook — fire when issue reaches a state with no outgoing transitions
    const finalStage = getStageDefinition(stages, updated.state);
    if (finalStage && finalStage.validTransitions.length === 0) {
      deps.onTerminalState?.(updated)?.catch((err) => {
        console.warn(`[workflow] Terminal-state hook failed for issue ${updated.id}:`, err);
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
  function resolveTaskPlaybook(parentId: WorkflowIssueId): string | undefined {
    const parent = issues.findById(parentId);
    if (!parent?.playbookRowId) return undefined;

    const parentPlaybook = topologyLoader.loadPlaybookForIssue(parent);
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
      issueId: WorkflowIssueId,
      toState: WorkflowState,
      actor: TransitionActor,
      comment?: string,
      data?: Record<string, unknown>,
    ): WorkflowIssue {
      const issue = requireIssue(issueId);
      return applyTransition(issue, toState, actor, comment, data);
    },

    approve(issueId: WorkflowIssueId, comment?: string, actor: TransitionActor = { type: 'human' }): WorkflowIssue {
      const issue = requireIssue(issueId);
      const stages = topologyLoader.loadForIssue(issue);

      if (!isHumanGate(stages, issue.state)) {
        throw new Error(`Issue '${issue.id}' is not at a human gate (state: ${issue.state})`);
      }

      const stage = getStageDefinition(stages, issue.state);
      if (!stage) throw new Error(`No stage definition for ${issue.type}:${issue.state}`);

      const approvalTarget = stage.validTransitions.find((t) => t.trigger === 'human-approve');
      if (!approvalTarget) {
        throw new Error(`No approval transition defined for state '${issue.state}'`);
      }

      // Approval resolves any pending Dark Factory escalation (only touch stateData if it was set)
      const stateData = (issue.stateData || {}) as Record<string, unknown>;
      const clearEscalation = stateData.needsHuman === true ? { needsHuman: false } : undefined;
      return applyTransition(issue, approvalTarget.to, actor, comment, clearEscalation);
    },

    reject(issueId: WorkflowIssueId, comment?: string): WorkflowIssue {
      const issue = requireIssue(issueId);
      const stages = topologyLoader.loadForIssue(issue);

      if (!isHumanGate(stages, issue.state)) {
        throw new Error(`Issue '${issue.id}' is not at a human gate (state: ${issue.state})`);
      }

      const stage = getStageDefinition(stages, issue.state);
      if (!stage) throw new Error(`No stage definition for ${issue.type}:${issue.state}`);

      const rejectTarget = stage.validTransitions.find((t) => t.trigger === 'human-reject');
      if (!rejectTarget) {
        throw new Error(`No rejection transition defined for state '${issue.state}'`);
      }

      const actor: TransitionActor = { type: 'human' };
      // Human rejection resolves any pending Dark Factory escalation (only touch stateData if it was set)
      const stateData = (issue.stateData || {}) as Record<string, unknown>;
      const clearEscalation = stateData.needsHuman === true ? { needsHuman: false } : undefined;
      return applyTransition(issue, rejectTarget.to, actor, comment, clearEscalation);
    },

    onTaskCompleted(issueId: WorkflowIssueId): void {
      const issue = requireIssue(issueId);
      if (issue.type !== 'task') return;

      // Check if task is in a terminal state
      const stages = topologyLoader.loadForIssue(issue);
      if (!isTerminal(stages, issue.state)) return;

      // Resolve dependencies that depended on this task
      const unblockedIds = resolver.resolveAndUnblock(issueId);

      // Auto-transition unblocked issues via their 'all-deps-resolved' trigger
      const systemActor: TransitionActor = { type: 'system', reason: 'All dependencies resolved' };
      for (const unblockedId of unblockedIds) {
        const blocked = issues.findById(unblockedId);
        if (!blocked) continue;

        try {
          const blockedStages = topologyLoader.loadForIssue(blocked);
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
          console.warn(`Failed to unblock issue ${unblockedId}:`, err);
        }
      }

      // Check if parent epic should advance
      if (issue.parentId) {
        const epic = issues.findById(issue.parentId);
        if (epic && epic.type === 'epic') {
          try {
            const epicStages = topologyLoader.loadForIssue(epic);
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

    createEpic(data): WorkflowIssue {
      // Determine initial state from playbook
      let initialState: WorkflowState = 'idea';

      if (data.playbookRowId) {
        const stages = topologyLoader.loadByPlaybookRowId(data.playbookRowId);
        initialState = getEntryState(stages);
      }

      const epic = issues.create({
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
          : topologyLoader.loadForIssue(epic);
        const entryStage = getStageDefinition(stages, epic.state);
        const autoTarget = entryStage?.validTransitions.find((t) => t.trigger === 'auto');
        if (autoTarget) {
          const actor: TransitionActor = { type: 'system', reason: 'Auto-transition from entry state' };
          return applyTransition(epic, autoTarget.to, actor);
        }
      } catch {
        // No topology available - skip auto-transitions (issue stays in initial state)
      }

      return epic;
    },

    createTask(data): WorkflowIssue {
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

      const task = issues.create({
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

    createEpicAtPlanReview(data): WorkflowIssue {
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

      const epic = issues.create({
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
        issueId: epic.id,
        fromState: 'idea',
        toState: planReviewState,
        actor: { type: 'human' },
        comment: 'Epic created directly at plan-review with pre-written plan',
      });

      return epic;
    },
  };
}
