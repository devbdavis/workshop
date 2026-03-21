/**
 * General-purpose agent dispatcher — spawns Claude/Codex sessions for any
 * agent-actionable workflow state.
 *
 * The ExecutionDispatcher handles only the plan-review → executing transition.
 * This dispatcher covers everything else: triaging, planning, plan-critique,
 * splitting, integration-review, integration-fix, and task states like
 * ready, in-progress, code-review, changes-requested.
 */
import type {
  WorkflowTicket,
  WorkflowTicketId,
  TrackId,
  AgentRole,
} from '@foundation/types';
import type { WorkflowTicketRepository } from '@domain/workflow/repository';
import type { TrackRepository } from '@domain/track/repository';
import type { SummaryRepository } from '@domain/summary/repository';
import type { TerminalManager } from '@infrastructure/terminal/manager.js';
import { getStageDefinition } from '@domain/workflow/state-machine.js';
import { composeWorkflowPrompt, type PromptContext } from './prompt-composer.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface AgentDispatcher {
  /**
   * Called after any state transition. If the target state is agent-actionable
   * (and not 'executing', which is handled by ExecutionDispatcher), dispatches
   * the appropriate agent sessions.
   */
  onTransition(ticket: WorkflowTicket): Promise<void>;
}

export interface AgentDispatcherDeps {
  tickets: WorkflowTicketRepository;
  tracks: TrackRepository;
  summaries: SummaryRepository;
  terminal: TerminalManager;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createAgentDispatcher(deps: AgentDispatcherDeps): AgentDispatcher {
  const { tickets, tracks, summaries, terminal } = deps;

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
    const track = tracks.create({
      name: '_Workflow',
      description: 'System track for workflow agent sessions',
      label: 'system',
      status: 'active',
    });
    workflowTrackId = track.id;
    return track.id;
  }

  function resolveWorkingDir(ticket: WorkflowTicket): string | undefined {
    const trackId = ticket.trackId ?? resolveTrackIdFromParent(ticket);
    if (!trackId) return undefined;

    const repos = tracks.findReposByTrack(trackId);
    return repos.length > 0 ? repos[0].path : undefined;
  }

  function resolveTrackIdFromParent(ticket: WorkflowTicket): TrackId | undefined {
    if (!ticket.parentId) return undefined;
    const parent = tickets.findById(ticket.parentId);
    return parent?.trackId;
  }

  function buildPromptContext(ticket: WorkflowTicket): PromptContext {
    const ctx: PromptContext = {};
    const stateData = ticket.stateData as Record<string, unknown> | undefined;

    if (stateData?.planDraft && typeof stateData.planDraft === 'string') {
      ctx.planDraft = stateData.planDraft;
    }

    if (stateData?.feedback && Array.isArray(stateData.feedback)) {
      ctx.feedback = stateData.feedback as string[];
    }

    // Critic's findings (blocking/suggestion items from plan-critique)
    if (stateData?.findings && Array.isArray(stateData.findings)) {
      ctx.findings = stateData.findings as PromptContext['findings'];
    }

    // Human Q&A answers from triage phase
    if (stateData?.answers && Array.isArray(stateData.answers)) {
      ctx.answers = stateData.answers as PromptContext['answers'];
    }

    const trackId = ticket.trackId ?? resolveTrackIdFromParent(ticket);
    if (trackId) {
      const track = tracks.findById(trackId);
      if (track?.context) {
        ctx.trackContext = track.context;
      }
      const summary = summaries.findLatest(trackId);
      if (summary) {
        ctx.summary = summary.content;
      }
    }

    return ctx;
  }

  function buildInitialPrompt(ticket: WorkflowTicket, role: AgentRole): string {
    const lines = [
      `You are working on workflow ticket ${ticket.id} as a ${role} agent.`,
      '',
      `Ticket: ${ticket.title}`,
      '',
      'When you have completed your work, report the result by calling:',
      `  workshop_transition_ticket("${ticket.id}", "<target_state>")`,
      '',
    ];

    // Add role-specific completion instructions
    const completionMap: Partial<Record<AgentRole, string>> = {
      'triage': 'Transition to "specced" if the spec is complete, or "needs-input" if you have questions. When transitioning to needs-input, pass questions as structured data: workshop_transition_ticket(ticketId, "needs-input", "summary comment", { pendingQuestions: [{ text: "question?" }] })',
      'planner': 'Transition to "plan-critique" when the plan is ready for review.',
      'plan-critic': 'Transition to "plan-review" if no blocking findings, or "planning" if blocking findings exist.',
      'splitter': 'Create child tasks via workshop_create_task, then transition to "in-progress".',
      'implementer': 'Transition to "code-review" when implementation is complete.',
      'code-reviewer': 'Transition to "done" if review passes, or "changes-requested" if issues found.',
      'integration-reviewer': 'Transition to "final-review" if no blocking findings, or "integration-fix" if issues found.',
      'fixer': 'Transition to "integration-review" when fixes are complete.',
    };

    const instructions = completionMap[role];
    if (instructions) {
      lines.push(instructions);
    }

    return lines.join('\n');
  }

  return {
    async onTransition(ticket: WorkflowTicket): Promise<void> {
      const stage = getStageDefinition(ticket.type, ticket.state);
      if (!stage || !stage.agentActionable) return;

      // 'executing' is handled by ExecutionDispatcher
      if (ticket.state === 'executing') return;

      const role = stage.agentRole;
      if (!role) {
        console.warn(`Agent-actionable state '${ticket.state}' has no agentRole defined`);
        return;
      }

      const count = stage.agentCount ?? 1;
      const workingDir = resolveWorkingDir(ticket);
      const context = buildPromptContext(ticket);
      const systemPrompt = composeWorkflowPrompt(role, ticket, context);
      const initialPrompt = buildInitialPrompt(ticket, role);
      const trackId = ticket.trackId ?? resolveTrackIdFromParent(ticket) ?? getOrCreateWorkflowTrack();

      const sessionIds: string[] = [];

      for (let i = 0; i < count; i++) {
        try {
          const session = await terminal.createSession(trackId, {
            systemPrompt,
            background: true,
            initialPrompt,
            workingDirectory: workingDir,
            executionTicketId: ticket.id,
          });
          sessionIds.push(session.id);
          console.log(
            `Agent dispatched: ${role} (${i + 1}/${count}) for ticket ${ticket.id} → session ${session.id}`,
          );
        } catch (err) {
          console.error(`Failed to dispatch ${role} agent for ticket ${ticket.id}:`, err);
        }
      }

      // Store dispatched session IDs in stateData
      if (sessionIds.length > 0) {
        const existingData = (ticket.stateData || {}) as Record<string, unknown>;
        tickets.update(ticket.id, {
          assignedAgentRole: role,
          stateData: {
            ...existingData,
            agentSessionIds: sessionIds,
            dispatchedAt: new Date().toISOString(),
          },
        });
      }
    },
  };
}
