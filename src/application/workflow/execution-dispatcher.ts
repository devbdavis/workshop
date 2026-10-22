/**
 * Application service that orchestrates execution dispatch after plan-review approval.
 *
 * Owns the full "approve -> dispatch -> compensate on failure" flow so the HTTP layer
 * stays thin and any caller of approveWithExecution gets consistent behavior.
 */
import type {
  WorkflowIssue,
  WorkflowIssueId,
  TrackId,
} from '@foundation/types.js';
import type { WorkflowIssueRepository } from '@domain/workflow/issue-repository.js';
import type { TrackRepository } from '@domain/track/repository.js';
import type { TerminalManager } from '@domain/terminal/manager.js';
import type { WorkflowEngine } from './engine.js';
import type { TopologyLoader } from './topology-loader.js';
import { getStageDefinition } from '@domain/workflow/types.js';
import type { StageDefinition } from '@domain/workflow/types.js';
import { formatPlanContent } from './prompt-composer.js';
import { isAutonomous } from './autonomy.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ExecutionDispatcher {
  /** Approve an issue at a human gate — if the result is an execution stage, dispatch automatically. */
  approveWithExecution(issueId: WorkflowIssueId, comment?: string): Promise<WorkflowIssue>;

  /** Dispatch execution for an issue already in an execution stage (e.g. retry). */
  dispatch(issueId: WorkflowIssueId): Promise<void>;
}

export interface ExecutionDispatcherDeps {
  engine: WorkflowEngine;
  issues: WorkflowIssueRepository;
  tracks: TrackRepository;
  terminal: TerminalManager;
  topologyLoader: TopologyLoader;
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
    // Fallback for backward compat
    if (trigger === 'execution-complete') return 'integration-review';
    if (trigger === 'execution-failed') return 'execution-failed';
    return null;
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createExecutionDispatcher(
  deps: ExecutionDispatcherDeps,
): ExecutionDispatcher {
  const { engine, issues, tracks, terminal, topologyLoader } = deps;

  /** Lazily find-or-create a _Workflow track for issues without a track */
  let workflowTrackId: TrackId | null = null;
  function getOrCreateWorkflowTrack(): TrackId {
    if (workflowTrackId) {
      const existing = tracks.findById(workflowTrackId);
      if (existing) return workflowTrackId;
    }
    const all = tracks.findAll();
    const existing = all.find((t) => t.name === '_Workflow');
    if (existing) {
      workflowTrackId = existing.id;
      return existing.id;
    }
    const created = tracks.create({
      name: '_Workflow',
      description: 'System track for workflow agent sessions',
      label: 'system',
      status: 'active',
    });
    workflowTrackId = created.id;
    return created.id;
  }

  async function dispatchExecution(issue: WorkflowIssue): Promise<void> {
    const systemPrompt = composeExecutionPrompt(issue, deps);

    const repos = issue.trackId
      ? tracks.findReposByTrack(issue.trackId)
      : [];
    if (repos.length === 0) {
      throw new Error(
        `Cannot dispatch execution for issue ${issue.id}: no repositories configured on track`,
      );
    }
    const workingDir = repos[0].path;

    // Find the completion target from topology
    const completionTarget = findTransitionTarget(topologyLoader, issue, 'execution-complete');
    const failedTarget = findTransitionTarget(topologyLoader, issue, 'execution-failed');

    let stage: StageDefinition | undefined;
    try {
      stage = getStageDefinition(topologyLoader.loadForIssue(issue), issue.state);
    } catch {
      stage = undefined;
    }

    const session = await terminal.createSession(
      issue.trackId || getOrCreateWorkflowTrack(),
      {
        systemPrompt,
        background: true,
        initialPrompt: buildInitialPrompt(issue, completionTarget, failedTarget),
        workingDirectory: workingDir,
        executionIssueId: issue.id,
        dangerouslySkipPermissions: isAutonomous(issue, issues),
        model: stage?.model,
      },
    );

    issues.update(issue.id, {
      executionSessionId: session.id,
      stateData: {
        ...(issue.stateData || {}),
        agentProgress: [],
      } as Record<string, unknown>,
    });

    console.log(
      `Execution dispatched for issue ${issue.id} -> session ${session.id}`,
    );
  }

  return {
    async approveWithExecution(
      issueId: WorkflowIssueId,
      comment?: string,
    ): Promise<WorkflowIssue> {
      let current = engine.approve(issueId, comment);

      if (!isExecutionStage(topologyLoader, current)) {
        return current;
      }

      try {
        await dispatchExecution(current);
        // Re-read to get the updated executionSessionId
        current = issues.findById(issueId) || current;
      } catch (dispatchErr) {
        console.error('Failed to dispatch execution:', dispatchErr);
        const failedTarget = findTransitionTarget(topologyLoader, current, 'execution-failed');
        if (failedTarget) {
          try {
            current = engine.transition(
              current.id,
              failedTarget,
              { type: 'system', reason: 'Dispatch failed' },
              dispatchErr instanceof Error
                ? dispatchErr.message
                : 'Failed to dispatch execution session',
            );
          } catch {
            console.error('Failed to mark issue as execution-failed:', issueId);
          }
        }
      }

      return current;
    },

    async dispatch(issueId: WorkflowIssueId): Promise<void> {
      const issue = issues.findById(issueId);
      if (!issue) throw new Error(`Issue not found: ${issueId}`);

      if (!isExecutionStage(topologyLoader, issue)) {
        throw new Error(
          `Issue ${issueId} is not in an execution stage (current: ${issue.state})`,
        );
      }
      await dispatchExecution(issue);
    },
  };
}

// ---------------------------------------------------------------------------
// Prompt composition
// ---------------------------------------------------------------------------

function composeExecutionPrompt(
  issue: WorkflowIssue,
  deps: ExecutionDispatcherDeps,
): string {
  const { tracks } = deps;
  const parts: string[] = [];

  parts.push(
    '# Execution Context',
    '',
    `You are executing the approved implementation plan for: **${issue.title}**`,
    '',
    `Workflow Issue ID: ${issue.id}`,
  );

  parts.push('', '## Approved Specification', '', issue.description || '(no description)');

  const stateData = issue.stateData as Record<string, unknown> | undefined;
  const planDraft = stateData?.planDraft;
  if (planDraft && typeof planDraft === 'string') {
    parts.push('', formatPlanContent(planDraft, 'Approved Implementation Plan'));
  }

  if (issue.trackId) {
    const track = tracks.findById(issue.trackId);
    if (track) {
      if (track.context) {
        parts.push('', '## Project Context', '', track.context);
      }

      const repos = tracks.findReposByTrack(issue.trackId);
      if (repos.length > 0) {
        parts.push(
          '',
          '## Repositories',
          '',
          ...repos.map(
            (r) => `- ${r.path}${r.remoteUrl ? ` (${r.remoteUrl})` : ''}`,
          ),
        );
      }

      const trackPaths = tracks.findPathsByTrack(issue.trackId);
      if (trackPaths.length > 0) {
        parts.push(
          '',
          '## Track Paths',
          '',
          ...trackPaths.map(
            (p) => `- ${p.path}${p.label ? ` (${p.label})` : ''}`,
          ),
        );
      }
    }
  }

  parts.push(
    '',
    '## Execution Strategy: Delegate to Agent Teams',
    '',
    'You are the **orchestrator**, not the sole implementer. For any non-trivial plan:',
    '',
    '1. **Read the plan** and break it into logical work units (phases, features, modules)',
    '2. **Delegate each unit** to a sub-agent using the Agent tool (aka Task tool)',
    '   - Launch multiple agents in parallel when their work is independent',
    '   - Each agent should handle one coherent unit of work',
    '3. **Coordinate**: review agent outputs, resolve conflicts, ensure integration',
    '4. **Verify**: run builds, tests, and typecheck after agents complete',
    '',
    '### Context Passing (CRITICAL)',
    '',
    'When spawning each sub-agent, you MUST include in its prompt:',
    '- The relevant section of the implementation plan (not the whole plan - just their part)',
    '- The project context and repository paths',
    '- Any outputs from prior agents that are dependencies for their work',
    '- Clear scope boundaries: what they should and should NOT touch',
    '',
    'Do NOT try to implement a large multi-phase plan in a single session.',
    'Delegate, coordinate, verify.',
  );

  return parts.join('\n');
}

function buildInitialPrompt(
  issue: WorkflowIssue,
  completionTarget: string | null,
  failedTarget: string | null,
): string {
  const successState = completionTarget || 'integration-review';
  const failState = failedTarget || 'execution-failed';

  return [
    `Execute the approved implementation plan for workflow issue ${issue.id}.`,
    '',
    'Your system prompt contains the spec, plan, and project context.',
    'Read the plan carefully. Break it into work units and delegate to sub-agents.',
    '',
    '**Your role is ORCHESTRATOR:**',
    '- Read the full plan first',
    '- Identify phases/modules that can be worked on independently',
    '- Spawn agent teams to implement each unit in parallel where possible',
    '- Coordinate their outputs and resolve integration issues',
    '- Run final verification (build, typecheck, tests)',
    '',
    'For small/simple plans, you may implement directly. For multi-phase plans, you MUST delegate.',
    '',
    `When done, report results via: workshop_transition_issue("${issue.id}", "${successState}", ...)`,
    `On failure: workshop_transition_issue("${issue.id}", "${failState}", ...)`,
  ].join('\n');
}
