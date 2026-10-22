import { describe, it, expect } from 'vitest';
import { composeWorkflowPrompt } from '@application/workflow/prompt-composer';
import type { WorkflowIssue, AgentRole, WorkflowIssueId } from '@foundation/types';

function makeIssue(overrides?: Partial<WorkflowIssue>): WorkflowIssue {
  return {
    id: 'issue-1' as WorkflowIssueId,
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
    it('should include issue title and description', () => {
      const issue = makeIssue();
      const prompt = composeWorkflowPrompt('triage', issue);

      expect(prompt).toContain('triage specialist');
      expect(prompt).toContain('Add user authentication');
      expect(prompt).toContain('Implement OAuth2 with Google and GitHub providers');
    });

    it('should mention questions response format', () => {
      const prompt = composeWorkflowPrompt('triage', makeIssue());
      expect(prompt).toContain('needs-input');
      expect(prompt).toContain('pendingQuestions');
    });

    it('should instruct agent to produce refinedSpec', () => {
      const prompt = composeWorkflowPrompt('triage', makeIssue());
      expect(prompt).toContain('refinedSpec');
    });

    it('should instruct agent to update description when answers exist', () => {
      const issue = makeIssue({
        stateData: {
          answers: [
            { text: 'Storage?', answer: 'in memory' },
          ],
        },
      });
      const prompt = composeWorkflowPrompt('triage', issue);
      expect(prompt).toContain('workshop_update_issue');
      expect(prompt).toContain('refinedSpec');
      expect(prompt).toContain('in memory');
    });
  });

  describe('planner role', () => {
    it('should include spec from issue description', () => {
      const prompt = composeWorkflowPrompt('planner', makeIssue());
      expect(prompt).toContain('technical architect');
      expect(prompt).toContain('## Spec');
      expect(prompt).toContain('Implement OAuth2');
    });

    it('should include previous feedback when provided', () => {
      const prompt = composeWorkflowPrompt('planner', makeIssue(), {
        feedback: ['Missing error handling', 'Need rate limiting'],
      });
      expect(prompt).toContain('Previous Revision Notes');
      expect(prompt).toContain('- Missing error handling');
      expect(prompt).toContain('- Need rate limiting');
    });

    it('should omit feedback section when no feedback', () => {
      const prompt = composeWorkflowPrompt('planner', makeIssue());
      expect(prompt).not.toContain('Previous Revision Notes');
    });

    it('should include human answers when provided', () => {
      const prompt = composeWorkflowPrompt('planner', makeIssue(), {
        answers: [
          { text: 'Storage strategy?', answer: 'in memory is fine' },
          { text: 'Which provider?', answer: 'use replicate' },
        ],
      });
      expect(prompt).toContain('Human Answers');
      expect(prompt).toContain('AUTHORITATIVE');
      expect(prompt).toContain('in memory is fine');
      expect(prompt).toContain('use replicate');
    });

    it('should include previous plan draft for revisions', () => {
      const prompt = composeWorkflowPrompt('planner', makeIssue(), {
        planDraft: 'Step 1: Create middleware\nStep 2: Add routes',
      });
      expect(prompt).toContain('## Previous Plan Draft');
      expect(prompt).toContain('Step 1: Create middleware');
      expect(prompt).toContain('REVISION');
    });

    it('should include critic findings when provided', () => {
      const prompt = composeWorkflowPrompt('planner', makeIssue(), {
        findings: [
          { text: 'Plan contradicts human answer on storage', severity: 'blocking' },
          { text: 'Missing cleanup on destroy', severity: 'suggestion' },
        ],
        planDraft: 'some plan',
      });
      expect(prompt).toContain('BLOCKING Findings');
      expect(prompt).toContain('Plan contradicts human answer on storage');
      expect(prompt).toContain('Suggestions from Plan Critic');
      expect(prompt).toContain('Missing cleanup on destroy');
    });

    it('should exclude resolved findings', () => {
      const prompt = composeWorkflowPrompt('planner', makeIssue(), {
        findings: [
          { text: 'Already fixed', severity: 'blocking', resolved: true },
          { text: 'Still broken', severity: 'blocking', resolved: false },
        ],
        planDraft: 'some plan',
      });
      expect(prompt).not.toContain('Already fixed');
      expect(prompt).toContain('Still broken');
    });

    it('should mention required plan sections', () => {
      const prompt = composeWorkflowPrompt('planner', makeIssue());
      expect(prompt).toContain('architecture');
      expect(prompt).toContain('file changes');
      expect(prompt).toContain('API design');
      expect(prompt).toContain('test strategy');
    });
  });

  describe('plan-critic role', () => {
    it('should include plan draft when provided', () => {
      const prompt = composeWorkflowPrompt('plan-critic', makeIssue(), {
        planDraft: 'Step 1: Create auth middleware\nStep 2: Add OAuth routes',
      });
      expect(prompt).toContain('adversarial reviewer');
      expect(prompt).toContain('## Plan to Review');
      expect(prompt).toContain('Create auth middleware');
    });

    it('should mention BLOCKING and SUGGESTION categories', () => {
      const prompt = composeWorkflowPrompt('plan-critic', makeIssue());
      expect(prompt).toContain('BLOCKING');
      expect(prompt).toContain('SUGGESTION');
    });
  });

  describe('splitter role', () => {
    it('should include plan draft when provided', () => {
      const prompt = composeWorkflowPrompt('splitter', makeIssue(), {
        planDraft: 'The plan has 3 phases',
      });
      expect(prompt).toContain('splitting a technical plan');
      expect(prompt).toContain('The plan has 3 phases');
    });

    it('should request JSON array output', () => {
      const prompt = composeWorkflowPrompt('splitter', makeIssue());
      expect(prompt).toContain('JSON array');
      expect(prompt).toContain('dependsOn');
    });
  });

  describe('implementer role', () => {
    it('should include task title and description', () => {
      const task = makeIssue({ type: 'task', title: 'Create auth middleware' });
      const prompt = composeWorkflowPrompt('implementer', task);
      expect(prompt).toContain('implementing a specific task');
      expect(prompt).toContain('Task: Create auth middleware');
    });

    it('should mention code, tests, and documentation', () => {
      const prompt = composeWorkflowPrompt('implementer', makeIssue());
      expect(prompt).toContain('code');
      expect(prompt).toContain('tests');
      expect(prompt).toContain('documentation');
    });
  });

  describe('code-reviewer role', () => {
    it('should mention fkh-review methodology', () => {
      const prompt = composeWorkflowPrompt('code-reviewer', makeIssue());
      expect(prompt).toContain('fkh-review');
    });

    it('should include review criteria', () => {
      const prompt = composeWorkflowPrompt('code-reviewer', makeIssue());
      expect(prompt).toContain('code quality');
      expect(prompt).toContain('test coverage');
      expect(prompt).toContain('security');
      expect(prompt).toContain('architecture');
    });
  });

  describe('integration-reviewer role', () => {
    it('should include spec and plan when provided', () => {
      const prompt = composeWorkflowPrompt('integration-reviewer', makeIssue(), {
        planDraft: 'Original plan: 3 phases',
      });
      expect(prompt).toContain('Spec: Implement OAuth2');
      expect(prompt).toContain('## Plan');
      expect(prompt).toContain('Original plan: 3 phases');
    });

    it('should ask to compare delivery vs spec', () => {
      const prompt = composeWorkflowPrompt('integration-reviewer', makeIssue());
      expect(prompt).toContain('Compare what was delivered vs what was specified');
    });
  });

  describe('fixer role', () => {
    it('should include findings when provided', () => {
      const prompt = composeWorkflowPrompt('fixer', makeIssue(), {
        feedback: ['SQL injection risk', 'Missing input validation'],
      });
      expect(prompt).toContain('fixing issues');
      expect(prompt).toContain('## Review Findings');
      expect(prompt).toContain('- SQL injection risk');
      expect(prompt).toContain('- Missing input validation');
    });

    it('should include issue description', () => {
      const prompt = composeWorkflowPrompt('fixer', makeIssue());
      expect(prompt).toContain('Implement OAuth2');
    });

    it('should omit findings section when no feedback', () => {
      const prompt = composeWorkflowPrompt('fixer', makeIssue());
      expect(prompt).not.toContain('## Review Findings');
      expect(prompt).toContain('Address each finding');
    });
  });

  describe('unknown role', () => {
    it('should return a generic prompt with title and description', () => {
      const prompt = composeWorkflowPrompt('unknown-role' as AgentRole, makeIssue());
      expect(prompt).toContain('Add user authentication');
      expect(prompt).toContain('Implement OAuth2');
    });
  });

  describe('context appendage', () => {
    it('should append track context when provided', () => {
      const prompt = composeWorkflowPrompt('triage', makeIssue(), {
        trackContext: 'This project uses Express and PostgreSQL',
      });
      expect(prompt).toContain('## Track Context');
      expect(prompt).toContain('This project uses Express and PostgreSQL');
    });

    it('should not append context sections when not provided', () => {
      const prompt = composeWorkflowPrompt('triage', makeIssue());
      expect(prompt).not.toContain('## Track Context');
      expect(prompt).not.toContain('---');
    });
  });
});
