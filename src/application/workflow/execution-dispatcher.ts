/**
 * Dispatches the execution pipeline when a workflow plan is approved.
 *
 * Composes a handover package (spec + plan + track context) into a system prompt,
 * creates a background session with execution hooks, and binds the session to the ticket.
 */
import type {
  WorkflowTicket,
  WorkflowTicketId,
  TrackId,
} from '@foundation/types';
import type { WorkflowTicketRepository } from '@domain/workflow/repository';
import type { TrackRepository } from '@domain/track/repository';
import type { SummaryRepository } from '@domain/summary/repository';
import type { TerminalManager } from '@infrastructure/terminal/manager.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ExecutionDispatcher {
  /** Dispatch execution for a ticket that just transitioned to 'executing' */
  dispatch(ticketId: WorkflowTicketId): Promise<void>;
}

export interface ExecutionDispatcherDeps {
  tickets: WorkflowTicketRepository;
  tracks: TrackRepository;
  summaries: SummaryRepository;
  terminal: TerminalManager;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createExecutionDispatcher(
  deps: ExecutionDispatcherDeps,
): ExecutionDispatcher {
  const { tickets, tracks, summaries, terminal } = deps;

  return {
    async dispatch(ticketId: WorkflowTicketId): Promise<void> {
      const ticket = tickets.findById(ticketId);
      if (!ticket) throw new Error(`Ticket not found: ${ticketId}`);
      if (ticket.state !== 'executing') {
        throw new Error(
          `Ticket ${ticketId} is not in 'executing' state (current: ${ticket.state})`,
        );
      }

      // Compose the handover system prompt
      const systemPrompt = composeExecutionPrompt(ticket, deps);

      // Determine working directory from track repos
      const repos = ticket.trackId
        ? tracks.findReposByTrack(ticket.trackId)
        : [];
      const workingDir = repos[0]?.path || process.env.HOME || '/tmp';

      // Create background session with execution hooks
      const session = await terminal.createSession(
        ticket.trackId || ('_execution' as TrackId),
        {
          systemPrompt,
          background: true,
          initialPrompt: buildInitialPrompt(ticket),
          workingDirectory: workingDir,
          executionTicketId: ticket.id,
        },
      );

      // Bind session to ticket — executionSessionId as top-level field (used by
      // session-end safety net hook to find the ticket) plus progress in stateData
      tickets.update(ticket.id, {
        executionSessionId: session.id,
        stateData: {
          ...(ticket.stateData || {}),
          agentProgress: [],
        },
      });

      console.log(
        `Execution dispatched for ticket ${ticket.id} → session ${session.id}`,
      );
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
  const { tracks, summaries } = deps;
  const parts: string[] = [];

  // Header
  parts.push(
    '# Execution Context',
    '',
    `You are executing the approved implementation plan for: **${ticket.title}**`,
    '',
    `Workflow Ticket ID: ${ticket.id}`,
  );

  // Approved spec
  parts.push('', '## Approved Specification', '', ticket.description || '(no description)');

  // Approved plan from stateData
  const planDraft = (ticket.stateData as Record<string, unknown> | undefined)
    ?.planDraft;
  if (planDraft && typeof planDraft === 'string') {
    parts.push('', '## Approved Implementation Plan', '', planDraft);
  }

  // Track context
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

      // Latest summary
      const summary = summaries.findLatest(ticket.trackId);
      if (summary) {
        parts.push('', '## Current Project Status', '', summary.content);
      }
    }
  }

  // Instructions for context passing
  parts.push(
    '',
    '## IMPORTANT: Context Passing',
    '',
    'When delegating to any agent via the Task tool, you MUST include:',
    '1. The Approved Implementation Plan section above (full text)',
    '2. The Project Context and Repository information',
    '3. Full text of all previous agent outputs',
    '',
    'All agents need the complete picture to do their work correctly.',
  );

  return parts.join('\n');
}

function buildInitialPrompt(ticket: WorkflowTicket): string {
  return [
    `Execute the approved implementation plan for workflow ticket ${ticket.id}.`,
    '',
    'Your system prompt contains the full spec, plan, and project context.',
    'Follow the workflow steps: Implementation → Test Design → Test Implementation → Code Review → Git/PR.',
    '',
    `When done, report results via: workshop_transition_ticket("${ticket.id}", "integration-review", ...)`,
    `On failure: workshop_transition_ticket("${ticket.id}", "execution-failed", ...)`,
  ].join('\n');
}
