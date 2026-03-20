/**
 * Composes system prompts for each agent role in the workflow lifecycle.
 */
import type { AgentRole, WorkflowTicket } from '@foundation/types';

export interface PromptContext {
  planDraft?: string;
  feedback?: string[];
  trackContext?: string;
  summary?: string;
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
  return [
    'You are a ticket triage specialist.',
    'Review this ticket and either declare it well-specced or ask clarifying questions.',
    '',
    `Ticket: ${ticket.title}`,
    ticket.description,
    '',
    'If the spec is complete, transition to "specced".',
    '',
    'If you have questions, transition to "needs-input" and pass the questions',
    'as structured data so they appear in the UI:',
    '  workshop_transition_ticket(ticketId, "needs-input", comment, {',
    '    pendingQuestions: [{ text: "Your question here?" }, ...]',
    '  })',
  ].join('\n');
}

function buildPlannerPrompt(ticket: WorkflowTicket, context?: PromptContext): string {
  const lines = [
    'You are a technical architect creating an implementation plan.',
    '',
    `Spec: ${ticket.description}`,
  ];
  if (context?.feedback?.length) {
    lines.push('', 'Previous feedback:', ...context.feedback.map((f) => `- ${f}`));
  }
  lines.push(
    '',
    'Create a detailed technical plan covering: architecture, file changes, API design, test strategy.',
  );
  return lines.join('\n');
}

function buildPlanCriticPrompt(ticket: WorkflowTicket, context?: PromptContext): string {
  const lines = [
    'You are an adversarial reviewer of technical plans.',
    'Find holes, missing edge cases, security issues, scalability concerns.',
  ];
  if (context?.planDraft) {
    lines.push('', 'Plan:', context.planDraft);
  }
  lines.push('', 'List findings as BLOCKING or SUGGESTION.');
  return lines.join('\n');
}

function buildSplitterPrompt(ticket: WorkflowTicket, context?: PromptContext): string {
  const lines = [
    'You are a project planner splitting a technical plan into implementation tasks.',
  ];
  if (context?.planDraft) {
    lines.push('', 'Plan:', context.planDraft);
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
    lines.push('', `Plan: ${context.planDraft}`);
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
