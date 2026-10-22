/**
 * Unified orchestrator that wraps the workflow engine, execution dispatcher,
 * and agent dispatcher into a single coordination point.
 *
 * All state transitions flow through here so dispatch side-effects are
 * consistently triggered regardless of the caller (HTTP routes, MCP tools,
 * automation rules).
 */
import type {
  WorkflowIssue,
  WorkflowIssueId,
  WorkflowState,
  TransitionActor,
} from '@foundation/types.js';
import type { WorkflowIssueRepository } from '@domain/workflow/issue-repository.js';
import type { WorkflowEngine } from './engine.js';
import type { ExecutionDispatcher } from './execution-dispatcher.js';
import type { AgentDispatcher } from './agent-dispatcher.js';
import type { TopologyLoader } from './topology-loader.js';
import { getStageDefinition, isTerminal, canAutoApprove } from '@domain/workflow/types.js';
import { isAutonomous } from './autonomy.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface DispatchCoordinator {
  /** Transition an issue and auto-dispatch agents if the target state is agent-actionable */
  transitionWithDispatch(
    issueId: WorkflowIssueId,
    toState: WorkflowState,
    actor: TransitionActor,
    comment?: string,
    data?: Record<string, unknown>,
  ): Promise<WorkflowIssue>;

  /** Approve at human gate and dispatch if result state needs agents */
  approveWithDispatch(issueId: WorkflowIssueId, comment?: string): Promise<WorkflowIssue>;

  /** Reject at human gate — may dispatch if target state is agent-actionable */
  reject(issueId: WorkflowIssueId, comment?: string): Promise<WorkflowIssue>;

  /** Dispatch agents for an issue that is already in an agent-actionable state (e.g. retry) */
  dispatchForCurrentState(issueId: WorkflowIssueId): Promise<void>;
}

export interface DispatchCoordinatorDeps {
  engine: WorkflowEngine;
  issues: WorkflowIssueRepository;
  executionDispatcher: ExecutionDispatcher;
  agentDispatcher: AgentDispatcher;
  topologyLoader: TopologyLoader;
  /** Called when an epic advances (used to re-wire engine callback) */
  onEpicAdvanced?: (issue: WorkflowIssue) => Promise<void>;
  /** Dark Factory: called when an autonomous issue comes to rest at a human gate or terminal state */
  onAutonomousRest?: (issueId: WorkflowIssueId) => Promise<void>;
  /** Dark Factory usage pacing: returns whether autonomous work should pause now, and until when */
  usageGate?: () => { over: boolean; resumeAt?: string };
  /** Dark Factory: called when an autonomous issue is paused for usage pacing */
  onPaused?: (issueId: WorkflowIssueId, until?: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a stage is an execution stage (has execution-complete or execution-failed triggers).
 */
function isExecutionStage(
  topologyLoader: TopologyLoader,
  issue: WorkflowIssue,
): boolean {
  try {
    const stages = topologyLoader.loadForIssue(issue);
    const stage = getStageDefinition(stages, issue.state);
    return stage?.validTransitions.some(
      (t) => t.trigger === 'execution-complete' || t.trigger === 'execution-failed',
    ) ?? false;
  } catch {
    // No playbook — fallback to hardcoded check for backward compat
    return issue.state === 'executing';
  }
}

/**
 * Find the target state for a given trigger from the current stage.
 */
function findTransitionTarget(
  topologyLoader: TopologyLoader,
  issue: WorkflowIssue,
  trigger: string,
): string | null {
  try {
    const stages = topologyLoader.loadForIssue(issue);
    const stage = getStageDefinition(stages, issue.state);
    const transition = stage?.validTransitions.find((t) => t.trigger === trigger);
    return transition?.to ?? null;
  } catch {
    return null;
  }
}

/** Max gates to auto-advance through in one call, to prevent runaway loops. */
const MAX_AUTO_ADVANCE_DEPTH = 8;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createDispatchCoordinator(
  deps: DispatchCoordinatorDeps,
): DispatchCoordinator {
  const { engine, issues, executionDispatcher, agentDispatcher, topologyLoader } = deps;

  async function dispatchIfNeeded(issue: WorkflowIssue): Promise<void> {
    // Dark Factory usage pacing: don't spawn new autonomous work while over the
    // usage threshold — pause the issue instead; the poller resumes it later.
    if (deps.usageGate && isAutonomous(issue, issues)) {
      const gate = deps.usageGate();
      if (gate.over) {
        issues.update(issue.id, {
          stateData: { ...(issue.stateData || {}), paused: true, pausedUntil: gate.resumeAt },
        });
        await deps.onPaused?.(issue.id, gate.resumeAt);
        return;
      }
    }

    // Check if this is an execution stage
    if (isExecutionStage(topologyLoader, issue)) {
      try {
        await executionDispatcher.dispatch(issue.id);
      } catch (err) {
        console.error('Execution dispatch failed:', err);
        // Find the execution-failed target from topology
        const failedTarget = findTransitionTarget(topologyLoader, issue, 'execution-failed');
        if (failedTarget) {
          try {
            engine.transition(
              issue.id,
              failedTarget,
              { type: 'system', reason: 'Dispatch failed' },
              err instanceof Error ? err.message : 'Failed to dispatch execution session',
            );
          } catch {
            console.error('Failed to mark issue as execution-failed:', issue.id);
          }
        }
      }
      return;
    }

    // General agent dispatch for all other agent-actionable states
    await agentDispatcher.onTransition(issue);
  }

  /**
   * Check if a state is terminal for task completion handling.
   */
  function checkIsTerminal(issue: WorkflowIssue, state: WorkflowState): boolean {
    try {
      const stages = topologyLoader.loadForIssue(issue);
      return isTerminal(stages, state);
    } catch {
      // No playbook — fallback to hardcoded check
      return state === 'done' || state === 'cancelled' || state === 'merged';
    }
  }

  /**
   * Dark Factory: for autonomous issues, auto-approve through human gates
   * (except merge/terminal gates and any gate an escalation is waiting on).
   */
  async function autoAdvanceGates(issueId: WorkflowIssueId): Promise<void> {
    let issue = issues.findById(issueId);
    if (!issue || !isAutonomous(issue, issues)) return;

    for (let i = 0; i < MAX_AUTO_ADVANCE_DEPTH; i++) {
      issue = issues.findById(issueId);
      if (!issue) return;

      const stages = topologyLoader.loadForIssue(issue);
      const stage = getStageDefinition(stages, issue.state);
      if (!stage || !stage.humanGate) return;

      const stateData = (issue.stateData || {}) as Record<string, unknown>;
      if (stateData.needsHuman === true) return;
      if (!canAutoApprove(stage)) return;

      const approveTransition = stage.validTransitions.find((t) => t.trigger === 'human-approve');
      if (!approveTransition) return;
      if (isTerminal(stages, approveTransition.to)) return;

      const updated = engine.approve(issueId, 'Dark Factory: auto-approved', {
        type: 'system',
        reason: 'dark-factory-auto-approve',
      });
      await dispatchIfNeeded(updated);
    }

    const rested = issues.findById(issueId);
    if (!rested) return;
    const restedStages = topologyLoader.loadForIssue(rested);
    const restedStage = getStageDefinition(restedStages, rested.state);
    const atRest = restedStage?.humanGate === true || isTerminal(restedStages, rested.state);
    if (atRest) {
      try {
        await deps.onAutonomousRest?.(issueId);
      } catch (err) {
        console.warn(`[dark-factory] onAutonomousRest failed for issue ${issueId}:`, err);
      }
    }
  }

  return {
    async transitionWithDispatch(
      issueId: WorkflowIssueId,
      toState: WorkflowState,
      actor: TransitionActor,
      comment?: string,
      data?: Record<string, unknown>,
    ): Promise<WorkflowIssue> {
      const updated = engine.transition(issueId, toState, actor, comment, data);

      // If a task reached a terminal state, resolve dependencies and check epic progress
      if (updated.type === 'task' && checkIsTerminal(updated, toState)) {
        engine.onTaskCompleted(issueId);
      }

      await dispatchIfNeeded(updated);
      await autoAdvanceGates(issueId);

      // Re-read in case dispatchIfNeeded updated stateData
      return issues.findById(issueId) ?? updated;
    },

    async approveWithDispatch(
      issueId: WorkflowIssueId,
      comment?: string,
    ): Promise<WorkflowIssue> {
      const updated = engine.approve(issueId, comment);

      // If a task reached a terminal state via approval, resolve dependencies
      if (updated.type === 'task' && checkIsTerminal(updated, updated.state)) {
        engine.onTaskCompleted(issueId);
      }

      await dispatchIfNeeded(updated);
      await autoAdvanceGates(issueId);

      return issues.findById(issueId) ?? updated;
    },

    async reject(issueId: WorkflowIssueId, comment?: string): Promise<WorkflowIssue> {
      const updated = engine.reject(issueId, comment);

      // Rejection can land on agent-actionable states (e.g. final-review -> integration-fix)
      await dispatchIfNeeded(updated);
      await autoAdvanceGates(issueId);

      return issues.findById(issueId) ?? updated;
    },

    async dispatchForCurrentState(issueId: WorkflowIssueId): Promise<void> {
      const issue = issues.findById(issueId);
      if (!issue) throw new Error(`Issue not found: ${issueId}`);
      await dispatchIfNeeded(issue);
      await autoAdvanceGates(issueId);
    },
  };
}
