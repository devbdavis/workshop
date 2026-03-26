/**
 * General-purpose agent dispatcher — spawns Claude/Codex sessions for any
 * agent-actionable workflow state.
 *
 * The ExecutionDispatcher handles only execution stages (those with
 * execution-complete/execution-failed triggers). This dispatcher covers
 * everything else: triaging, planning, plan-critique, splitting,
 * integration-review, integration-fix, and task states like ready,
 * in-progress, code-review, changes-requested.
 */
import type {
  WorkflowTicket,
  WorkflowTicketId,
  TrackId,
  SessionId,
} from '@foundation/types.js';
import type { WorkflowTicketRepository } from '@domain/workflow/ticket-repository.js';
import type { TrackRepository } from '@domain/track/repository.js';
import type { SummaryRepository } from '@domain/summary/repository.js';
import type { TerminalManager } from '@domain/terminal/manager.js';
import type { TopologyLoader } from './topology-loader.js';
import type { AgentRoleRepository, AgentRoleRow } from '@domain/workflow/agent-role-repository.js';
import { getStageDefinition, isAgentActionable } from '@domain/workflow/types.js';
import type { StageDefinition } from '@domain/workflow/types.js';
import { composeWorkflowPrompt, composeDataDrivenPrompt, type PromptContext } from './prompt-composer.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface AgentDispatcher {
  /**
   * Called after any state transition. If the target state is agent-actionable
   * (and not an execution stage), dispatches the appropriate agent sessions.
   */
  onTransition(ticket: WorkflowTicket): Promise<void>;
}

export interface AgentDispatcherDeps {
  tickets: WorkflowTicketRepository;
  tracks: TrackRepository;
  summaries: SummaryRepository;
  terminal: TerminalManager;
  topologyLoader: TopologyLoader;
  agentRoles: AgentRoleRepository;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a stage is an execution stage (handled by ExecutionDispatcher).
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
    // No playbook — fallback to hardcoded check
    return ticket.state === 'executing';
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createAgentDispatcher(deps: AgentDispatcherDeps): AgentDispatcher {
  const { tickets, tracks, summaries, terminal, topologyLoader, agentRoles } = deps;

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

    // Integration-review findings — structured review results for the fixer agent
    if (stateData?.reviewFindings && typeof stateData.reviewFindings === 'object') {
      const rf = stateData.reviewFindings as Record<string, unknown>;
      const lines: string[] = [];
      if (rf.verdict) lines.push(`Verdict: ${rf.verdict}`);
      if (rf.summary) lines.push(`Summary: ${rf.summary}`);
      if (Array.isArray(rf.blocking)) {
        for (const b of rf.blocking as Array<Record<string, unknown>>) {
          const missing = Array.isArray(b.missing) ? (b.missing as string[]).join(', ') : '';
          lines.push(`[${b.status}] ${b.phase}${missing ? ': ' + missing : ''}`);
        }
      }
      if (lines.length > 0) {
        ctx.feedback = [...(ctx.feedback || []), ...lines];
      }
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

  /**
   * Build the initial prompt for the agent, using role from DB if available.
   */
  function buildInitialPrompt(
    ticket: WorkflowTicket,
    roleName: string,
    agentRole: AgentRoleRow | null,
  ): string {
    const lines = [
      `You are working on workflow ticket ${ticket.id} as a ${roleName} agent.`,
      '',
      `Ticket: ${ticket.title}`,
      '',
      'When you have completed your work, report the result by calling:',
      `  workshop_transition_ticket("${ticket.id}", "<target_state>")`,
      '',
    ];

    // Use completion instructions from role if available
    if (agentRole?.promptBlock.completionInstructions) {
      lines.push(agentRole.promptBlock.completionInstructions);
    } else {
      // Fallback to hardcoded role-specific completion instructions
      const completionMap: Record<string, string> = {
        'workflow-designer': 'When your workflow proposal is ready, call workshop_propose_playbook with the epicId, epicPlaybook, taskPlaybook (if needed), agentRoles, and rationale. The proposal will be stored for human approval — do NOT transition the ticket yourself.',
        'triage': 'When the spec is complete: (1) optionally update the description via workshop_update_ticket to reflect any Q&A refinements, (2) transition to "specced" with the refined spec: workshop_transition_ticket(ticketId, "specced", "summary", { refinedSpec: "full spec text..." }). If you have questions: transition to "needs-input" with: workshop_transition_ticket(ticketId, "needs-input", "summary", { pendingQuestions: [{ text: "question?" }] })',
        'planner': 'Transition to "plan-critique" when the plan is ready for review.',
        'plan-critic': 'Transition to "plan-review" if no blocking findings, or "planning" if blocking findings exist.',
        'splitter': 'Create child tasks via workshop_create_task, then transition to "in-progress".',
        'implementer': 'Transition to "code-review" when implementation is complete.',
        'code-reviewer': 'Transition to "done" if review passes, or "changes-requested" if issues found.',
        'integration-reviewer': 'Transition to "final-review" if no blocking findings, or "integration-fix" if issues found.',
        'fixer': 'Transition to "integration-review" when fixes are complete.',
      };

      const instructions = completionMap[roleName];
      if (instructions) {
        lines.push(instructions);
      }
    }

    return lines.join('\n');
  }

  /** Kill any previously dispatched agent sessions for a ticket */
  async function killPreviousSessions(ticket: WorkflowTicket): Promise<void> {
    const stateData = (ticket.stateData || {}) as Record<string, unknown>;
    const previousIds = stateData.agentSessionIds;
    if (!Array.isArray(previousIds)) return;

    for (const sid of previousIds) {
      try {
        await terminal.destroySession(sid as SessionId);
        console.log(`Cleaned up previous agent session ${sid} for ticket ${ticket.id}`);
      } catch {
        // Session might already be dead - that's fine
      }
    }
  }

  /**
   * Derive agent role from stage definition (topology-driven).
   */
  function getStageRole(ticket: WorkflowTicket): {
    roleName: string;
    agentCount: number;
    agentRole: AgentRoleRow | null;
    stage: StageDefinition | null;
  } | null {
    try {
      const stages = topologyLoader.loadForTicket(ticket);
      const stage = getStageDefinition(stages, ticket.state);
      if (!stage || !stage.agentActionable) return null;

      // Load agent role from DB if agentRoleId is set
      let agentRole: AgentRoleRow | null = null;
      if (stage.agentRoleId) {
        agentRole = agentRoles.findById(stage.agentRoleId);
      }

      // Role name: from DB role, or from stage.agentRoleId, or derive from state
      const roleName = agentRole?.name ?? stage.agentRoleId ?? deriveRoleFromState(ticket.state);
      const agentCount = stage.agentCount ?? 1;

      return { roleName, agentCount, agentRole, stage };
    } catch {
      // No playbook — fallback to hardcoded role derivation
      return {
        roleName: deriveRoleFromState(ticket.state),
        agentCount: 1,
        agentRole: null,
        stage: null,
      };
    }
  }

  /**
   * Derive role name from state (backward compat for tickets without playbooks).
   */
  function deriveRoleFromState(state: string): string {
    const roleMap: Record<string, string> = {
      'idea': 'workflow-designer',
      'triaging': 'triage',
      'planning': 'planner',
      'plan-critique': 'plan-critic',
      'splitting': 'splitter',
      'integration-review': 'integration-reviewer',
      'integration-fix': 'fixer',
      'ready': 'implementer',
      'in-progress': 'implementer',
      'code-review': 'code-reviewer',
      'changes-requested': 'implementer',
    };
    return roleMap[state] ?? state;
  }

  /**
   * Check if ticket state is agent-actionable.
   */
  function checkAgentActionable(ticket: WorkflowTicket): boolean {
    try {
      const stages = topologyLoader.loadForTicket(ticket);
      return isAgentActionable(stages, ticket.state);
    } catch {
      // No playbook — fallback to hardcoded check
      const agentActionableStates: Record<string, string[]> = {
        epic: ['idea', 'triaging', 'planning', 'plan-critique', 'splitting', 'integration-review', 'integration-fix'],
        task: ['ready', 'in-progress', 'code-review', 'changes-requested'],
      };
      return agentActionableStates[ticket.type]?.includes(ticket.state) ?? false;
    }
  }

  return {
    async onTransition(ticket: WorkflowTicket): Promise<void> {
      // Skip execution stages (handled by ExecutionDispatcher)
      if (isExecutionStage(topologyLoader, ticket)) return;

      // Check if agent-actionable
      if (!checkAgentActionable(ticket)) return;

      const roleInfo = getStageRole(ticket);
      if (!roleInfo) {
        console.warn(`Agent-actionable state '${ticket.state}' has no role defined`);
        return;
      }

      const { roleName, agentCount, agentRole, stage } = roleInfo;

      // Kill previous agent sessions before dispatching new ones
      await killPreviousSessions(ticket);

      const workingDir = resolveWorkingDir(ticket);
      const context = buildPromptContext(ticket);

      // Data-driven prompt composition when a stage definition is available
      // (agentRole may be null if the role isn't in the DB yet).
      // Legacy switch-based composer is only used when there's no stage at all.
      let systemPrompt: string;
      if (stage) {
        const playbook = topologyLoader.loadPlaybookForTicket(ticket);
        const playbookOverrides = playbook?.promptOverrides;
        systemPrompt = composeDataDrivenPrompt(agentRole, ticket, stage, playbookOverrides, context);
      } else {
        systemPrompt = composeWorkflowPrompt(roleName, ticket, context);
      }

      const initialPrompt = buildInitialPrompt(ticket, roleName, agentRole);
      const trackId = ticket.trackId ?? resolveTrackIdFromParent(ticket) ?? getOrCreateWorkflowTrack();

      const sessionIds: string[] = [];

      for (let i = 0; i < agentCount; i++) {
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
            `Agent dispatched: ${roleName} (${i + 1}/${agentCount}) for ticket ${ticket.id} -> session ${session.id}`,
          );
        } catch (err) {
          console.error(`Failed to dispatch ${roleName} agent for ticket ${ticket.id}:`, err);
        }
      }

      // Store dispatched session IDs in stateData
      if (sessionIds.length > 0) {
        const existingData = (ticket.stateData || {}) as Record<string, unknown>;
        tickets.update(ticket.id, {
          assignedAgentRole: roleName,
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
