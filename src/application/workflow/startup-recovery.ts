/**
 * Startup recovery for workflow issues — detects agent-actionable issues
 * whose dispatched sessions have died, and re-dispatches them.
 *
 * This runs once on server startup (after a short delay to let session sync
 * complete) and can also be invoked on-demand.
 */
import type { WorkflowIssue, SessionId } from '@foundation/types.js';
import type { WorkflowIssueRepository } from '@domain/workflow/issue-repository.js';
import type { SessionRepository } from '@domain/session/repository';
import type { DispatchCoordinator } from './dispatch-coordinator.js';
import type { TopologyLoader } from './topology-loader.js';
import {
  isTerminal as topologyIsTerminal,
  isAgentActionable as topologyIsAgentActionable,
  getStageDefinition,
} from '@domain/workflow/types.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface WorkflowRecoveryResult {
  scanned: number;
  redispatched: string[];
  skipped: string[];
  errors: Array<{ issueId: string; error: string }>;
}

export interface WorkflowRecoveryDeps {
  issues: WorkflowIssueRepository;
  sessions: SessionRepository;
  dispatcher: DispatchCoordinator;
  topologyLoader: TopologyLoader;
}

// ---------------------------------------------------------------------------
// Helpers — topology-aware state checks with fallbacks for legacy issues
// ---------------------------------------------------------------------------

function checkIsTerminal(deps: WorkflowRecoveryDeps, issue: WorkflowIssue): boolean {
  try {
    if (issue.playbookRowId) {
      const stages = deps.topologyLoader.loadByPlaybookRowId(issue.playbookRowId);
      return topologyIsTerminal(stages, issue.state);
    }
  } catch { /* fall through */ }
  return ['done', 'cancelled', 'merged'].includes(issue.state);
}

function checkIsAgentActionable(deps: WorkflowRecoveryDeps, issue: WorkflowIssue): boolean {
  try {
    if (issue.playbookRowId) {
      const stages = deps.topologyLoader.loadByPlaybookRowId(issue.playbookRowId);
      return topologyIsAgentActionable(stages, issue.state);
    }
  } catch { /* fall through */ }
  // Fallback for issues without playbooks
  const agentStates: Record<string, string[]> = {
    epic: ['triaging', 'planning', 'plan-critique', 'splitting', 'integration-review', 'integration-fix'],
    task: ['ready', 'in-progress', 'code-review', 'changes-requested'],
  };
  return agentStates[issue.type]?.includes(issue.state) ?? false;
}

function checkIsExecutionStage(deps: WorkflowRecoveryDeps, issue: WorkflowIssue): boolean {
  try {
    if (issue.playbookRowId) {
      const stages = deps.topologyLoader.loadByPlaybookRowId(issue.playbookRowId);
      const stage = getStageDefinition(stages, issue.state);
      return stage?.validTransitions.some(
        (t) => t.trigger === 'execution-complete' || t.trigger === 'execution-failed',
      ) ?? false;
    }
  } catch { /* fall through */ }
  // Fallback for issues without playbooks
  return issue.state === 'executing';
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Scan all non-terminal workflow issues for ones that are in agent-actionable
 * states but have no live sessions. Re-dispatch those.
 */
export async function recoverStuckIssues(
  deps: WorkflowRecoveryDeps,
): Promise<WorkflowRecoveryResult> {
  const { issues, sessions } = deps;
  const result: WorkflowRecoveryResult = {
    scanned: 0,
    redispatched: [],
    skipped: [],
    errors: [],
  };

  // Get all issues — filter to non-terminal, agent-actionable states
  const allIssues = issues.findAll();
  const candidates = allIssues.filter(
    (t) =>
      !checkIsTerminal(deps, t) &&
      checkIsAgentActionable(deps, t) &&
      !checkIsExecutionStage(deps, t) && // execution stages are handled by ExecutionDispatcher
      (t.stateData as Record<string, unknown> | undefined)?.paused !== true, // Dark Factory: paused runs resume via the usage-pacing poller, not recovery
  );

  result.scanned = candidates.length;

  for (const issue of candidates) {
    const sessionIds = getDispatchedSessionIds(issue);

    if (sessionIds.length === 0) {
      // Never dispatched or sessions list was cleared — re-dispatch
      await redispatch(issue, 'no session IDs recorded', deps, result);
      continue;
    }

    // Check if any dispatched session is still alive
    const hasLiveSession = sessionIds.some((sid) => {
      const session = sessions.findById(sid as SessionId);
      return session && session.state === 'active';
    });

    if (!hasLiveSession) {
      await redispatch(issue, 'all dispatched sessions are dead/missing', deps, result);
    } else {
      result.skipped.push(issue.id);
    }
  }

  return result;
}

function getDispatchedSessionIds(issue: WorkflowIssue): string[] {
  const stateData = issue.stateData as Record<string, unknown> | undefined;
  if (!stateData) return [];

  const ids = stateData.agentSessionIds;
  if (Array.isArray(ids)) return ids as string[];

  // Also check executionSessionId for executing state
  if (issue.executionSessionId) return [issue.executionSessionId];

  return [];
}

async function redispatch(
  issue: WorkflowIssue,
  reason: string,
  deps: WorkflowRecoveryDeps,
  result: WorkflowRecoveryResult,
): Promise<void> {
  try {
    console.log(
      `[workflow-recovery] Re-dispatching issue ${issue.id} (${issue.type}:${issue.state}) — ${reason}`,
    );
    await deps.dispatcher.dispatchForCurrentState(issue.id);
    result.redispatched.push(issue.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[workflow-recovery] Failed to re-dispatch ${issue.id}: ${message}`);
    result.errors.push({ issueId: issue.id, error: message });
  }
}
