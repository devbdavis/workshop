import { describe, it, expect } from 'vitest';
import { listTemplates, ensurePlaybookForTemplate } from '../../src/application/workflow/template-loader.js';
import { generateShiftReport } from '../../src/application/workflow/shift-report.js';
import type { PlaybookRepository, PlaybookRow } from '../../src/domain/workflow/playbook-repository.js';
import type { WorkflowTransitionRepository } from '../../src/domain/workflow/issue-repository.js';
import type { TopologyLoader } from '../../src/application/workflow/topology-loader.js';
import type { StageDefinition } from '../../src/domain/workflow/types.js';
import type { WorkflowIssue, WorkflowTransition } from '../../src/foundation/types.js';

const PROJECT_ROOT = process.cwd();

describe('template-loader', () => {
  it('lists the bundled templates with intake questions', () => {
    const templates = listTemplates(PROJECT_ROOT);
    const slugs = templates.map((t) => t.slug);
    expect(slugs).toContain('new-web-app');
    expect(slugs).toContain('feature-on-existing-repo');
    for (const t of templates) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.intakeQuestions.length).toBeGreaterThan(0);
    }
  });

  it('seeds a playbook once and is idempotent', () => {
    const rows: PlaybookRow[] = [];
    const fakePlaybooks = {
      findLatest: (id: string) => rows.find((r) => r.id === id) ?? null,
      create: (input: Omit<PlaybookRow, 'rowId' | 'createdAt' | 'updatedAt' | 'isLatest'>) => {
        const row = { ...input, rowId: `row-${rows.length}`, isLatest: true, createdAt: '', updatedAt: '' } as PlaybookRow;
        rows.push(row);
        return row;
      },
    } as unknown as PlaybookRepository;

    const first = ensurePlaybookForTemplate(PROJECT_ROOT, 'new-web-app', fakePlaybooks);
    const second = ensurePlaybookForTemplate(PROJECT_ROOT, 'new-web-app', fakePlaybooks);
    expect(first).toBe(second);
    expect(rows.length).toBe(1);
    expect(rows[0].stageDefinitions.length).toBeGreaterThan(0);
  });
});

describe('shift-report', () => {
  const gateStage: StageDefinition = {
    state: 'final-review',
    semanticRole: 'human-gate',
    agentActionable: false,
    humanGate: true,
    autoApprovable: false,
    validTransitions: [{ to: 'done', trigger: 'human-approve' }],
  };
  const terminalStage: StageDefinition = {
    state: 'done',
    semanticRole: 'terminal',
    agentActionable: false,
    humanGate: false,
    validTransitions: [],
  };
  const stages = [gateStage, terminalStage];

  const topologyLoader = { loadForIssue: () => stages } as unknown as TopologyLoader;
  const transitions = {
    findByIssue: (): WorkflowTransition[] => [
      { id: 't1', issueId: 'k1', fromState: 'execute', toState: 'integration-review', actor: { type: 'agent' }, comment: 'tests passing, 42 green', createdAt: '2026-07-30T00:00:00Z' } as WorkflowTransition,
    ],
  } as unknown as WorkflowTransitionRepository;

  function issue(state: string, sd: Record<string, unknown>): WorkflowIssue {
    return { id: 'k1', type: 'epic', title: 'Reading list', description: 'see https://github.com/x/y/pull/3', state, stateData: sd, provider: 'claude', priority: 'medium', sortOrder: 0, stateChangedAt: '', createdAt: '', updatedAt: '' } as WorkflowIssue;
  }

  it('reports awaiting-merge at the final gate', () => {
    const r = generateShiftReport(issue('final-review', { stepCount: 5 }), { transitions, topologyLoader }, 'now');
    expect(r.reason).toBe('awaiting-merge');
    expect(r.stepsUsed).toBe(5);
    expect(r.markdown).toContain('pull/3');
    expect(r.markdown).toContain('tests passing');
  });

  it('reports escalated when needsHuman is set', () => {
    const r = generateShiftReport(issue('final-review', { needsHuman: true }), { transitions, topologyLoader }, 'now');
    expect(r.reason).toBe('escalated');
    expect(r.markdown).toContain('Needs your attention');
  });

  it('reports done at a terminal state', () => {
    const r = generateShiftReport(issue('done', {}), { transitions, topologyLoader }, 'now');
    expect(r.reason).toBe('done');
  });
});
