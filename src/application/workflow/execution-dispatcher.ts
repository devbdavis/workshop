/**
 * Application service that orchestrates execution dispatch after plan-review approval.
 *
 * Owns the full "approve -> dispatch -> compensate on failure" flow so the HTTP layer
 * stays thin and any caller of approveWithExecution gets consistent behavior.
 */
import type {
  WorkflowTicket,
  WorkflowTicketId,
  TrackId,
} from '@foundation/types.js';
import type { WorkflowTicketRepository } from '@domain/workflow/ticket-repository.js';
import type { TrackRepository } from '@domain/track/repository.js';
import type { TerminalManager } from '@domain/terminal/manager.js';
import type { WorkflowEngine } from './engine.js';
import type { TopologyLoader } from './topology-loader.js';
import { getStageDefinition } from '@domain/workflow/types.js';
import { formatPlanContent } from './prompt-composer.js';
import { isAutonomous } from './autonomy.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ExecutionDispatcher {
  /** Approve a ticket at a human gate — if the result is an execution stage, dispatch automatically. */
  approveWithExecution(ticketId: WorkflowTicketId, comment?: string): Promise<WorkflowTicket>;

  /** Dispatch execution for a ticket already in an execution stage (e.g. retry). */
  dispatch(ticketId: WorkflowTicketId): Promise<void>;
}

export interface ExecutionDispatcherDeps {
  engine: WorkflowEngine;
  tickets: WorkflowTicketRepository;
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
  ticket: WorkflowTicket,
): boolean {
  try {
    const stages = topologyLoader.loadForTicket(ticket);
    const stage = getStageDefinition(stages, ticket.state);
    return stage?.validTransitions.some(
      (t) => t.trigger === 'execution-complete' || t.trigger === 'execution-failed',
    ) ?? false;
  } catch {
    // No playbook — fallback to hardcoded check for backward compat
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
  const { engine, tickets, tracks, terminal, topologyLoader } = deps;

  /** Lazily find-or-create a _Workflow track for tickets without a track */
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

  async function dispatchExecution(ticket: WorkflowTicket): Promise<void> {
    const systemPrompt = composeExecutionPrompt(ticket, deps);

    const repos = ticket.trackId
      ? tracks.findReposByTrack(ticket.trackId)
      : [];
    if (repos.length === 0) {
      throw new Error(
        `Cannot dispatch execution for ticket ${ticket.id}: no repositories configured on track`,
      );
    }
    const workingDir = repos[0].path;

    // Find the completion target from topology
    const completionTarget = findTransitionTarget(topologyLoader, ticket, 'execution-complete');
    const failedTarget = findTransitionTarget(topologyLoader, ticket, 'execution-failed');

    const session = await terminal.createSession(
      ticket.trackId || getOrCreateWorkflowTrack(),
      {
        systemPrompt,
        background: true,
        initialPrompt: buildInitialPrompt(ticket, completionTarget, failedTarget),
        workingDirectory: workingDir,
        executionTicketId: ticket.id,
        dangerouslySkipPermissions: isAutonomous(ticket, tickets),
      },
    );

    tickets.update(ticket.id, {
      executionSessionId: session.id,
      stateData: {
        ...(ticket.stateData || {}),
        agentProgress: [],
      } as Record<string, unknown>,
    });

    console.log(
      `Execution dispatched for ticket ${ticket.id} -> session ${session.id}`,
    );
  }

  return {
    async approveWithExecution(
      ticketId: WorkflowTicketId,
      comment?: string,
    ): Promise<WorkflowTicket> {
      let current = engine.approve(ticketId, comment);

      if (!isExecutionStage(topologyLoader, current)) {
        return current;
      }

      try {
        await dispatchExecution(current);
        // Re-read to get the updated executionSessionId
        current = tickets.findById(ticketId) || current;
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
            console.error('Failed to mark ticket as execution-failed:', ticketId);
          }
        }
      }

      return current;
    },

    async dispatch(ticketId: WorkflowTicketId): Promise<void> {
      const ticket = tickets.findById(ticketId);
      if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);

      if (!isExecutionStage(topologyLoader, ticket)) {
        throw new Error(
          `Ticket ${ticketId} is not in an execution stage (current: ${ticket.state})`,
        );
      }
      await dispatchExecution(ticket);
    },
  };
}

// ---------------------------------------------------------------------------
// Prompt composition
// ---------------------------------------------------------------------------

function composeExecutionPrompt(
  ticket: WorkflowTicket,
  deps: ExecutionDispatcherDeps,
): string {
  const { tracks } = deps;
  const parts: string[] = [];

  parts.push(
    '# Execution Context',
    '',
    `You are executing the approved implementation plan for: **${ticket.title}**`,
    '',
    `Workflow Ticket ID: ${ticket.id}`,
  );

  parts.push('', '## Approved Specification', '', ticket.description || '(no description)');

  const stateData = ticket.stateData as Record<string, unknown> | undefined;
  const planDraft = stateData?.planDraft;
  if (planDraft && typeof planDraft === 'string') {
    parts.push('', formatPlanContent(planDraft, 'Approved Implementation Plan'));
  }

  if (ticket.trackId) {
    const track = tracks.findById(ticket.trackId);
    if (track) {
      if (track.context) {
        parts.push('', '## Project Context', '', track.context);
      }

      const repos = tracks.findReposByTrack(ticket.trackId);
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

      const trackPaths = tracks.findPathsByTrack(ticket.trackId);
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
  ticket: WorkflowTicket,
  completionTarget: string | null,
  failedTarget: string | null,
): string {
  const successState = completionTarget || 'integration-review';
  const failState = failedTarget || 'execution-failed';

  return [
    `Execute the approved implementation plan for workflow ticket ${ticket.id}.`,
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
    `When done, report results via: workshop_transition_ticket("${ticket.id}", "${successState}", ...)`,
    `On failure: workshop_transition_ticket("${ticket.id}", "${failState}", ...)`,
  ].join('\n');
}
