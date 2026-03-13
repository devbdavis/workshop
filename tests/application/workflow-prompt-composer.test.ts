import { describe, it, expect } from 'vitest';
import { composeWorkflowPrompt } from '@application/workflow/prompt-composer';
import type { WorkflowTicket, AgentRole, WorkflowTicketId } from '@foundation/types';

function makeTicket(overrides?: Partial<WorkflowTicket>): WorkflowTicket {
  return {
    id: 'ticket-1' as WorkflowTicketId,
    type: 'epic',
    title: 'Add user authentication',
    description: 'Implement OAuth2 with Google and GitHub providers',
    state: 'triaging',
    provider: 'claude',
    priority: 'medium',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    stateChangedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('composeWorkflowPrompt', () => {
  describe('triage role', () => {
    it('should include ticket title and description', () => {
      const ticket = makeTicket();
      const prompt = composeWorkflowPrompt('triage', ticket);

      expect(prompt).toContain('triage specialist');
      expect(prompt).toContain('Add user authentication');
      expect(prompt).toContain('Implement OAuth2 with Google and GitHub providers');
    });

    it('should mention QUESTIONS response format', () => {
      const prompt = composeWorkflowPrompt('triage', makeTicket());
      expect(prompt).toContain('QUESTIONS:');
    });
  });

  describe('planner role', () => {
    it('should include spec from ticket description', () => {
      const prompt = composeWorkflowPrompt('planner', makeTicket());
      expect(prompt).toContain('technical architect');
      expect(prompt).toContain('Spec: Implement OAuth2');
    });

    it('should include previous feedback when provided', () => {
      const prompt = composeWorkflowPrompt('planner', makeTicket(), {
        feedback: ['Missing error handling', 'Need rate limiting'],
      });
      expect(prompt).toContain('Previous feedback:');
      expect(prompt).toContain('- Missing error handling');
      expect(prompt).toContain('- Need rate limiting');
    });

    it('should omit feedback section when no feedback', () => {
      const prompt = composeWorkflowPrompt('planner', makeTicket());
      expect(prompt).not.toContain('Previous feedback:');
    });

    it('should mention required plan sections', () => {
      const prompt = composeWorkflowPrompt('planner', makeTicket());
      expect(prompt).toContain('architecture');
      expect(prompt).toContain('file changes');
      expect(prompt).toContain('API design');
      expect(prompt).toContain('test strategy');
    });
  });

  describe('plan-critic role', () => {
    it('should include plan draft when provided', () => {
      const prompt = composeWorkflowPrompt('plan-critic', makeTicket(), {
        planDraft: 'Step 1: Create auth middleware\nStep 2: Add OAuth routes',
      });
      expect(prompt).toContain('adversarial reviewer');
      expect(prompt).toContain('Plan:');
      expect(prompt).toContain('Create auth middleware');
    });

    it('should mention BLOCKING and SUGGESTION categories', () => {
      const prompt = composeWorkflowPrompt('plan-critic', makeTicket());
      expect(prompt).toContain('BLOCKING');
      expect(prompt).toContain('SUGGESTION');
    });
  });

  describe('splitter role', () => {
    it('should include plan draft when provided', () => {
      const prompt = composeWorkflowPrompt('splitter', makeTicket(), {
        planDraft: 'The plan has 3 phases',
      });
      expect(prompt).toContain('splitting a technical plan');
      expect(prompt).toContain('The plan has 3 phases');
    });

    it('should request JSON array output', () => {
      const prompt = composeWorkflowPrompt('splitter', makeTicket());
      expect(prompt).toContain('JSON array');
      expect(prompt).toContain('dependsOn');
    });
  });

  describe('implementer role', () => {
    it('should include task title and description', () => {
      const task = makeTicket({ type: 'task', title: 'Create auth middleware' });
      const prompt = composeWorkflowPrompt('implementer', task);
      expect(prompt).toContain('implementing a specific task');
      expect(prompt).toContain('Task: Create auth middleware');
    });

    it('should mention code, tests, and documentation', () => {
      const prompt = composeWorkflowPrompt('implementer', makeTicket());
      expect(prompt).toContain('code');
      expect(prompt).toContain('tests');
      expect(prompt).toContain('documentation');
    });
  });

  describe('code-reviewer role', () => {
    it('should mention fkh-review methodology', () => {
      const prompt = composeWorkflowPrompt('code-reviewer', makeTicket());
      expect(prompt).toContain('fkh-review');
    });

    it('should include review criteria', () => {
      const prompt = composeWorkflowPrompt('code-reviewer', makeTicket());
      expect(prompt).toContain('code quality');
      expect(prompt).toContain('test coverage');
      expect(prompt).toContain('security');
      expect(prompt).toContain('architecture');
    });
  });

  describe('integration-reviewer role', () => {
    it('should include spec and plan when provided', () => {
      const prompt = composeWorkflowPrompt('integration-reviewer', makeTicket(), {
        planDraft: 'Original plan: 3 phases',
      });
      expect(prompt).toContain('Spec: Implement OAuth2');
      expect(prompt).toContain('Plan: Original plan: 3 phases');
    });

    it('should ask to compare delivery vs spec', () => {
      const prompt = composeWorkflowPrompt('integration-reviewer', makeTicket());
      expect(prompt).toContain('Compare what was delivered vs what was specified');
    });
  });

  describe('fixer role', () => {
    it('should include findings when provided', () => {
      const prompt = composeWorkflowPrompt('fixer', makeTicket(), {
        feedback: ['SQL injection risk', 'Missing input validation'],
      });
      expect(prompt).toContain('fixing issues');
      expect(prompt).toContain('Findings:');
      expect(prompt).toContain('- SQL injection risk');
      expect(prompt).toContain('- Missing input validation');
    });

    it('should omit findings section when no feedback', () => {
      const prompt = composeWorkflowPrompt('fixer', makeTicket());
      expect(prompt).not.toContain('Findings:');
      expect(prompt).toContain('Address each finding');
    });
  });

  describe('unknown role', () => {
    it('should return a generic prompt with title and description', () => {
      const prompt = composeWorkflowPrompt('unknown-role' as AgentRole, makeTicket());
      expect(prompt).toContain('Add user authentication');
      expect(prompt).toContain('Implement OAuth2');
    });
  });

  describe('context appendage', () => {
    it('should append track context when provided', () => {
      const prompt = composeWorkflowPrompt('triage', makeTicket(), {
        trackContext: 'This project uses Express and PostgreSQL',
      });
      expect(prompt).toContain('## Track Context');
      expect(prompt).toContain('This project uses Express and PostgreSQL');
    });

    it('should append summary when provided', () => {
      const prompt = composeWorkflowPrompt('triage', makeTicket(), {
        summary: 'Auth module is 60% complete',
      });
      expect(prompt).toContain('## Current Status');
      expect(prompt).toContain('Auth module is 60% complete');
    });

    it('should append both context and summary separated by dividers', () => {
      const prompt = composeWorkflowPrompt('triage', makeTicket(), {
        trackContext: 'Context here',
        summary: 'Summary here',
      });
      expect(prompt).toContain('---');
      expect(prompt).toContain('## Track Context');
      expect(prompt).toContain('## Current Status');
      // Verify ordering: track context before summary
      const contextIdx = prompt.indexOf('## Track Context');
      const summaryIdx = prompt.indexOf('## Current Status');
      expect(contextIdx).toBeLessThan(summaryIdx);
    });

    it('should not append context sections when not provided', () => {
      const prompt = composeWorkflowPrompt('triage', makeTicket());
      expect(prompt).not.toContain('## Track Context');
      expect(prompt).not.toContain('## Current Status');
      expect(prompt).not.toContain('---');
    });
  });
});
