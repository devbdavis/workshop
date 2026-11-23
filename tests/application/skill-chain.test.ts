import { describe, it, expect } from 'vitest';
import { StageDefinitionsSchema } from '@domain/workflow/schemas';
import { validateWorkflowGraph } from '@application/workflow/graph-validator';
import { buildSkillChainStages } from '@application/workflow/skill-chain';

describe('buildSkillChainStages', () => {
  const stages = buildSkillChainStages([
    { prompt: '/review-app', pauseAfter: true },
    { prompt: '/egm-draft' },
    { prompt: '/egm-review' },
  ]);

  it('passes schema and graph validation', () => {
    const parsed = StageDefinitionsSchema.parse(stages);
    expect(validateWorkflowGraph(parsed)).toMatchObject({ valid: true, errors: [] });
  });

  it('orders states and wires transitions', () => {
    expect(stages.map((s) => s.state)).toEqual(['step-1', 'pause-1', 'step-2', 'step-3', 'final-review', 'done']);
    const to = (state: string): string[] => stages.find((s) => s.state === state)!.validTransitions.map((t) => t.to);
    expect(to('step-1')).toEqual(['pause-1']);
    expect(to('pause-1')).toEqual(['step-2', 'step-1']);
    expect(to('step-3')).toEqual(['final-review']);
    expect(to('final-review')).toEqual(['done', 'step-3']);
    expect(stages.find((s) => s.state === 'pause-1')!.autoApprovable).toBe(false);
  });

  it('rejects empty chains and blank prompts', () => {
    expect(() => buildSkillChainStages([])).toThrow();
    expect(() => buildSkillChainStages([{ prompt: '  ' }])).toThrow();
  });
});
