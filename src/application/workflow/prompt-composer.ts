/**
 * Composes system prompts for each agent role in the workflow lifecycle.
 */
import type { AgentRole, WorkflowTicket } from '@foundation/types';

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
 * Detect whether a planDraft value is a reference (vault path or file URL) vs inline content.
 * Returns formatted prompt text with read instructions if it's a reference.
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

  // Vault path — short string, no newlines, ends with .md, contains /
  if (!trimmed.includes('\n') && trimmed.endsWith('.md') && trimmed.includes('/') && trimmed.length < 300) {
    // Parse vault path: "TrackSlug/path/to/file.md" or "_Workflow/plans/file.md"
    const slashIdx = trimmed.indexOf('/');
    const trackSlug = trimmed.substring(0, slashIdx);
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

  // Inline content — include directly
  return `## ${heading}\n\n${trimmed}`;
}

/**
 * Build a system prompt tailored to the given agent role and ticket context.
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

function buildFixerPrompt(_ticket: WorkflowTicket, context?: PromptContext): string {
  const lines = ['You are fixing issues found during review.'];
  if (context?.feedback?.length) {
    lines.push('', 'Findings:', ...context.feedback.map((f) => `- ${f}`));
  }
  lines.push('', 'Address each finding.');
  return lines.join('\n');
}
