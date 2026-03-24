/**
 * Composes system prompts for each agent role in the workflow lifecycle.
 *
 * Supports two modes:
 * 1. Data-driven (preferred): composeDataDrivenPrompt() assembles prompts from
 *    AgentRoleRow + StageDefinition + PromptOverrides with merge priority:
 *      stage.promptOverride > template.promptOverrides[agentRoleId] > agentRole.promptBlock.preamble
 * 2. Legacy fallback: composeWorkflowPrompt() uses switch-based role matching
 *    for tickets without templates.
 */
import type { WorkflowTicket } from '@foundation/types';
import type { AgentRoleRow } from '@domain/workflow/agent-role-repository.js';
import type { StageDefinition, PromptOverrides } from '@domain/workflow/types.js';

export interface CritiqueFinding {
  text: string;
  severity: string;
  resolved?: boolean;
}

export interface TriageAnswer {
  text: string;
  answer: string;
}

export interface PromptContext {
  planDraft?: string;
  feedback?: string[];
  /** Blocking/suggestion findings from the plan-critic agent */
  findings?: CritiqueFinding[];
  /** Human answers from triage Q&A — these override the original spec */
  answers?: TriageAnswer[];
  trackContext?: string;
  summary?: string;
}

/**
 * Detect whether a planDraft value is a reference (vault path, file URL, or
 * relative file path) vs inline content, and return formatted prompt text
 * with explicit read instructions when it's a reference.
 */
export function formatPlanContent(planDraft: string, heading: string): string {
  const trimmed = planDraft.trim();

  // file:// URL — agent should read the local file
  if (trimmed.startsWith('file://')) {
    const filePath = trimmed.replace('file://', '');
    return [
      `## ${heading}`,
      '',
      `The plan is stored at: \`${filePath}\``,
      '',
      `**You MUST read this file first** before proceeding. Use your file reading tools to read \`${filePath}\`.`,
    ].join('\n');
  }

  // Short path-like string (no newlines, ends with .md, contains /)
  if (!trimmed.includes('\n') && trimmed.endsWith('.md') && trimmed.includes('/') && trimmed.length < 300) {
    const slashIdx = trimmed.indexOf('/');
    const firstSegment = trimmed.substring(0, slashIdx);

    // Vault path — first segment starts with _ (system track) or looks like a track slug
    // e.g. "_Workflow/plans/file.md" or "workshop-dev/plans/file.md"
    if (firstSegment.startsWith('_') || firstSegment.includes('-')) {
      const trackSlug = firstSegment;
      const filePath = trimmed.substring(slashIdx + 1);
      return [
        `## ${heading}`,
        '',
        `The plan is stored in the Workshop vault at: \`${trimmed}\``,
        '',
        `**You MUST read this file first** before proceeding. Use the workshop_vault_read tool:`,
        `  workshop_vault_read(trackSlug="${trackSlug}", filePath="${filePath}")`,
      ].join('\n');
    }

    // Relative file path — e.g. "plans/dynamic-workflow-engine.md"
    return [
      `## ${heading}`,
      '',
      `The plan is stored in the file: \`${trimmed}\``,
      '',
      `**You MUST read this file first** before proceeding. It is a relative path in the working directory.`,
    ].join('\n');
  }

  // Inline content — include directly
  return `## ${heading}\n\n${trimmed}`;
}

/**
 * Format stateData into readable prompt sections.
 * Dynamically assembled from stateData keys — no hardcoded structure.
 */
function formatStateData(stateData: Record<string, unknown>): string {
  const sections: string[] = [];

  if (stateData.planDraft && typeof stateData.planDraft === 'string') {
    sections.push(formatPlanContent(stateData.planDraft, 'Plan'));
  }

  if (stateData.refinedSpec && typeof stateData.refinedSpec === 'string') {
    sections.push(`## Refined Spec\n\n${stateData.refinedSpec}`);
  }

  if (Array.isArray(stateData.findings)) {
    const findings = stateData.findings as Array<{ text: string; severity: string; resolved?: boolean }>;
    const blocking = findings.filter(f => f.severity === 'blocking' && !f.resolved);
    const suggestions = findings.filter(f => f.severity === 'suggestion' && !f.resolved);
    if (blocking.length > 0) {
      sections.push('## Blocking Findings\n\n' + blocking.map((f, i) => `${i + 1}. ${f.text}`).join('\n'));
    }
    if (suggestions.length > 0) {
      sections.push('## Suggestions\n\n' + suggestions.map(f => `- ${f.text}`).join('\n'));
    }
  }

  if (Array.isArray(stateData.answers)) {
    const answers = stateData.answers as Array<{ text: string; answer: string }>;
    if (answers.length > 0) {
      sections.push(
        '## Human Answers (AUTHORITATIVE)\n\n' +
        answers.map(a => `**Q:** ${a.text}\n**A:** ${a.answer}`).join('\n\n'),
      );
    }
  }

  if (Array.isArray(stateData.feedback)) {
    const feedback = stateData.feedback as string[];
    if (feedback.length > 0) {
      sections.push('## Feedback\n\n' + feedback.map(f => `- ${f}`).join('\n'));
    }
  }

  // Integration review findings (structured)
  if (stateData.integrationReviewFindings && typeof stateData.integrationReviewFindings === 'object') {
    const irf = stateData.integrationReviewFindings as Record<string, unknown>;
    const lines: string[] = ['## Integration Review Findings'];
    if (Array.isArray(irf.blockingFindings)) {
      for (const f of irf.blockingFindings as Array<Record<string, unknown>>) {
        lines.push(`- [${f.severity}] ${f.title}: ${f.description}`);
      }
    }
    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}

/**
 * Data-driven prompt composition.
 *
 * Assembles prompts from structured building blocks with merge priority:
 *   stage.promptOverride > template.promptOverrides[agentRoleId] > agentRole.promptBlock.preamble
 *
 * This is the preferred path for tickets with workflow templates and agent roles.
 */
export function composeDataDrivenPrompt(
  agentRole: AgentRoleRow | null,
  ticket: WorkflowTicket,
  stage: StageDefinition,
  templateOverrides?: PromptOverrides,
  context?: PromptContext,
): string {
  const parts: string[] = [];

  // 1. Preamble from the agent role's prompt block (lowest priority base)
  if (agentRole) {
    parts.push(agentRole.promptBlock.preamble);
  }

  // 2. Template-level prompt override for this role (medium priority)
  const roleId = agentRole?.id ?? stage.agentRoleId;
  if (roleId && templateOverrides?.[roleId]) {
    parts.push(templateOverrides[roleId]);
  }

  // 3. Per-stage prompt override (highest specificity)
  if (stage.promptOverride) {
    parts.push(stage.promptOverride);
  }

  // 4. Ticket context (title, description)
  parts.push(`## Ticket: ${ticket.title}\n\n${ticket.description}`);

  // 5. State data context (plan drafts, findings, answers, etc.)
  if (ticket.stateData && Object.keys(ticket.stateData).length > 0) {
    const stateDataContent = formatStateData(ticket.stateData as Record<string, unknown>);
    if (stateDataContent) {
      parts.push(stateDataContent);
    }
  }

  // 6. Constraints from the agent role
  if (agentRole && agentRole.promptBlock.constraints.length > 0) {
    parts.push('## Constraints\n\n' + agentRole.promptBlock.constraints.map(c => `- ${c}`).join('\n'));
  }

  // 7. Completion instructions
  if (agentRole) {
    parts.push('## Completion\n\n' + agentRole.promptBlock.completionInstructions);
  }

  // 8. Track context and summary
  if (context?.trackContext) {
    parts.push(`## Track Context\n\n${context.trackContext}`);
  }
  if (context?.summary) {
    parts.push(`## Current Status\n\n${context.summary}`);
  }

  return parts.join('\n\n---\n\n');
}

// ---------------------------------------------------------------------------
// Legacy fallback — used for tickets without workflow templates
// ---------------------------------------------------------------------------

// AgentRole is now a string (dynamic)
type AgentRole = string;

/**
 * Build a system prompt tailored to the given agent role and ticket context.
 * Legacy fallback for tickets without workflow templates.
 */
export function composeWorkflowPrompt(
  role: AgentRole,
  ticket: WorkflowTicket,
  context?: PromptContext,
): string {
  const parts: string[] = [];

  // Add the role-specific prompt
  parts.push(buildRolePrompt(role, ticket, context));

  // Append track context when available
  if (context?.trackContext) {
    parts.push(`## Track Context\n\n${context.trackContext}`);
  }

  // Append current summary when available
  if (context?.summary) {
    parts.push(`## Current Status\n\n${context.summary}`);
  }

  return parts.join('\n\n---\n\n');
}

function buildRolePrompt(
  role: AgentRole,
  ticket: WorkflowTicket,
  context?: PromptContext,
): string {
  switch (role) {
    case 'workflow-designer':
      return buildWorkflowDesignerPrompt(ticket);
    case 'triage':
      return buildTriagePrompt(ticket);
    case 'planner':
      return buildPlannerPrompt(ticket, context);
    case 'plan-critic':
      return buildPlanCriticPrompt(ticket, context);
    case 'splitter':
      return buildSplitterPrompt(ticket, context);
    case 'implementer':
      return buildImplementerPrompt(ticket);
    case 'code-reviewer':
      return buildCodeReviewerPrompt(ticket);
    case 'integration-reviewer':
      return buildIntegrationReviewerPrompt(ticket, context);
    case 'fixer':
      return buildFixerPrompt(ticket, context);
    default:
      return `You are working on ticket: ${ticket.title}\n\n${ticket.description}`;
  }
}

function buildWorkflowDesignerPrompt(ticket: WorkflowTicket): string {
  return [
    'You are a workflow designer. Your job is to analyze this epic and design an appropriate',
    'workflow template that will govern how it moves through the system.',
    '',
    `## Epic: ${ticket.title}`,
    '',
    ticket.description,
    '',
    '## Your Task',
    '',
    '1. **Analyze** the epic to understand the type of work (feature, bugfix, refactor, docs, infra),',
    '   its complexity, and what agent roles are needed.',
    '',
    '2. **Search existing templates** via `workshop_list_workflow_templates({ ticketType: "epic" })`',
    '   and agent roles via `workshop_list_agent_roles()`. Reuse what exists.',
    '',
    '3. **Design or select** a workflow template:',
    '   - If an existing template is a good fit, use it directly.',
    '   - If not, design a new one following the schema below.',
    '   - Also design a companion task template (ticketType: "task") if the epic involves',
    '     splitting work into subtasks.',
    '',
    '4. **Create agent role definitions** for any roles referenced in your template that',
    '   don\'t already exist in the registry. Each role needs:',
    '   - id (kebab-case), name, description',
    '   - promptBlock: { preamble, toolAccessTier, constraints[], completionInstructions }',
    '   - toolsAllowed: string array of MCP tools/categories',
    '   - capabilityTier: "advisory" | "code-modification" | "infrastructure"',
    '',
    '5. **Validate** via `workshop_validate_workflow({ stageDefinitions: [...] })`.',
    '   Fix any validation errors.',
    '',
    '6. **Propose** via `workshop_propose_workflow({ epicId, epicTemplate, taskTemplate,',
    '   agentRoles, rationale })`. A human will review and approve.',
    '',
    '## Template Schema',
    '',
    'Epic template fields: id, name, description, ticketType ("epic"), stageDefinitions[], tags[], matchCriteria',
    '',
    '### Stage Definition',
    '```json',
    '{',
    '  "state": "kebab-case-name",',
    '  "semanticRole": "entry|processing|human-gate|terminal|error|waiting",',
    '  "agentActionable": true/false,',
    '  "humanGate": true/false,',
    '  "agentRoleId": "role-id (if agentActionable)",',
    '  "agentCount": 1,',
    '  "validTransitions": [',
    '    { "to": "target-state", "trigger": "agent-complete|human-approve|human-reject|auto|all-deps-resolved|all-tasks-done|manual|execution-complete|execution-failed" }',
    '  ]',
    '}',
    '```',
    '',
    '### Rules',
    '- First stage must have semanticRole: "entry"',
    '- At least one humanGate stage for non-trivial workflows',
    '- Terminal stages have empty validTransitions and semanticRole: "terminal"',
    '- Agent-actionable stages need agentRoleId',
    '- For trivial work: use a 2-3 state workflow (ready -> in-progress -> done)',
    '- Execution stages use execution-complete/execution-failed triggers for the actual',
    '  implementation work (creating child tasks, running builds, etc.)',
    '',
    '### Fallback',
    'If unsure, use a minimal workflow:',
    '  triaging (entry, agent) → spec-review (human-gate) → planning (agent)',
    '  → plan-review (human-gate) → executing (execution) → final-review (human-gate) → done',
    '',
    '## Important',
    '',
    '- Do NOT transition the ticket yourself. Only call workshop_propose_workflow.',
    '- The human will approve or reject your proposal.',
    '- Design the workflow to match the actual complexity of the work — don\'t over-engineer',
    '  a simple task with 10 stages, and don\'t under-engineer a complex project with 2.',
  ].join('\n');
}

function buildTriagePrompt(ticket: WorkflowTicket): string {
  const lines = [
    'You are a ticket triage specialist.',
    'Review this ticket and either declare it well-specced or ask clarifying questions.',
    '',
    `Ticket: ${ticket.title}`,
    ticket.description,
  ];

  // Include previous Q&A if the human already answered questions
  const sd = ticket.stateData as Record<string, unknown> | undefined;
  const answers = sd?.answers as Array<{ text: string; answer: string }> | undefined;
  if (answers && answers.length > 0) {
    lines.push('', '## Previous Questions & Human Answers', '');
    for (const a of answers) {
      lines.push(`Q: ${a.text}`);
      lines.push(`A: ${a.answer}`);
      lines.push('');
    }
    lines.push(
      'The human has answered the above questions.',
      '',
      '## Your Task',
      '',
      'Write a refined spec that incorporates ALL human answers into a coherent document.',
      'The refined spec should be a standalone document that supersedes the original description.',
      '',
      'When the spec is complete:',
      '1. First, update the ticket description to reflect the refined reality:',
      `   workshop_update_ticket("${ticket.id}", { description: "updated description..." })`,
      '2. Then transition to "specced" and pass the refined spec as structured data:',
      `   workshop_transition_ticket("${ticket.id}", "specced", "summary", {`,
      '     refinedSpec: "Your full refined spec here..."',
      '   })',
      '',
      'If you still have unanswered concerns, transition to "needs-input" with new questions.',
    );
  } else {
    lines.push(
      '',
      'If the spec is complete and no questions are needed:',
      '1. Write a refined spec summarizing the requirements clearly',
      '2. Transition to "specced" and pass the refined spec:',
      `   workshop_transition_ticket("${ticket.id}", "specced", "summary", {`,
      '     refinedSpec: "Your full refined spec here..."',
      '   })',
      '',
      'If you have questions, transition to "needs-input" and pass the questions',
      'as structured data so they appear in the UI:',
      `  workshop_transition_ticket("${ticket.id}", "needs-input", comment, {`,
      '    pendingQuestions: [{ text: "Your question here?" }, ...]',
      '  })',
    );
  }

  return lines.join('\n');
}

function buildPlannerPrompt(ticket: WorkflowTicket, context?: PromptContext): string {
  const isRevision = !!(context?.findings?.length || context?.planDraft);

  const lines = [
    'You are a technical architect creating an implementation plan.',
    '',
    `## Spec\n\n${ticket.description}`,
  ];

  // Human Q&A answers from triage — these are authoritative and override the original spec
  if (context?.answers?.length) {
    lines.push('', '## Human Answers (AUTHORITATIVE — these override the original spec)', '');
    for (const a of context.answers) {
      lines.push(`**Q:** ${a.text}`);
      lines.push(`**A:** ${a.answer}`);
      lines.push('');
    }
    lines.push(
      'The above answers were provided by the human stakeholder during triage.',
      'Your plan MUST be consistent with every one of these answers.',
      'If the spec says one thing but an answer says another, the answer wins.',
    );
  }

  // Previous plan draft — critical for revisions so the planner edits rather than regenerates
  if (context?.planDraft) {
    lines.push('', formatPlanContent(context.planDraft, 'Previous Plan Draft'));
  }

  // Critic's blocking findings — the actual issues to fix
  if (context?.findings?.length) {
    const blocking = context.findings.filter((f) => f.severity === 'blocking' && !f.resolved);
    const suggestions = context.findings.filter((f) => f.severity === 'suggestion' && !f.resolved);

    if (blocking.length > 0) {
      lines.push('', '## BLOCKING Findings from Plan Critic (MUST fix every one of these)', '');
      for (let i = 0; i < blocking.length; i++) {
        lines.push(`${i + 1}. ${blocking[i].text}`);
      }
      lines.push(
        '',
        'Each blocking finding above MUST be resolved in the revised plan.',
        'Do not claim something is addressed without actually changing the plan text.',
      );
    }

    if (suggestions.length > 0) {
      lines.push('', '## Suggestions from Plan Critic (address if feasible)', '');
      for (const s of suggestions) {
        lines.push(`- ${s.text}`);
      }
    }
  }

  // Planner's own self-reported feedback from previous iteration
  if (context?.feedback?.length) {
    lines.push('', '## Your Previous Revision Notes', ...context.feedback.map((f) => `- ${f}`));
  }

  if (isRevision) {
    lines.push(
      '',
      '## Instructions',
      '',
      'This is a REVISION of an existing plan. You must:',
      '1. Read the previous plan draft (see reference above) — do not regenerate from scratch',
      '2. Address every BLOCKING finding by making concrete changes to the plan',
      '3. Ensure the plan is consistent with all human answers',
      '4. Keep parts of the plan that are not affected by the findings',
      '5. Write the revised plan back to the same vault location when done',
    );
  } else {
    lines.push(
      '',
      '## Instructions',
      '',
      'Create a detailed technical plan covering: architecture, file changes, API design, test strategy.',
    );
  }

  return lines.join('\n');
}

function buildPlanCriticPrompt(ticket: WorkflowTicket, context?: PromptContext): string {
  const lines = [
    'You are an adversarial reviewer of technical plans.',
    'Find holes, missing edge cases, security issues, scalability concerns.',
  ];
  if (context?.planDraft) {
    lines.push('', formatPlanContent(context.planDraft, 'Plan to Review'));
  }
  lines.push('', 'List findings as BLOCKING or SUGGESTION.');
  return lines.join('\n');
}

function buildSplitterPrompt(ticket: WorkflowTicket, context?: PromptContext): string {
  const lines = [
    'You are a project planner splitting a technical plan into implementation tasks.',
  ];
  if (context?.planDraft) {
    lines.push('', formatPlanContent(context.planDraft, 'Plan'));
  }
  lines.push(
    '',
    'Create a JSON array of tasks with: title, description, dependsOn (array of task indices).',
  );
  return lines.join('\n');
}

function buildImplementerPrompt(ticket: WorkflowTicket): string {
  return [
    'You are implementing a specific task.',
    '',
    `Task: ${ticket.title}`,
    ticket.description,
    '',
    'Write the code, tests, and documentation needed.',
  ].join('\n');
}

function buildCodeReviewerPrompt(ticket: WorkflowTicket): string {
  return [
    'You are a code reviewer using the fkh-review methodology.',
    'Review the implementation for code quality, test coverage, security, and architecture.',
    '',
    `Task: ${ticket.title}`,
    ticket.description,
  ].join('\n');
}

function buildIntegrationReviewerPrompt(
  ticket: WorkflowTicket,
  context?: PromptContext,
): string {
  const lines = [
    'You are reviewing the full implementation against the original spec and plan.',
    '',
    `Spec: ${ticket.description}`,
  ];
  if (context?.planDraft) {
    lines.push('', formatPlanContent(context.planDraft, 'Plan'));
  }
  lines.push('', 'Compare what was delivered vs what was specified.');
  return lines.join('\n');
}

function buildFixerPrompt(ticket: WorkflowTicket, context?: PromptContext): string {
  const lines = [
    'You are fixing issues found during integration review.',
    '',
    `## Ticket: ${ticket.title}`,
    '',
    ticket.description,
  ];
  if (context?.planDraft) {
    lines.push('', formatPlanContent(context.planDraft, 'Implementation Plan'));
  }
  if (context?.feedback?.length) {
    lines.push('', '## Review Findings (MUST address all of these)', '');
    for (const f of context.feedback) {
      lines.push(`- ${f}`);
    }
  }
  lines.push(
    '',
    '## Instructions',
    '',
    'Address each finding above. Run builds, tests, and typecheck to verify your fixes.',
  );
  return lines.join('\n');
}
