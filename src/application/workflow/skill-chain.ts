import type { StageDefinition } from '@domain/workflow/types.js';

export interface ChainStep {
  prompt: string;
  pauseAfter?: boolean;
}

export const MAX_CHAIN_STEPS = 20;

function stepPrompt(i: number, n: number, prompt: string, next: string): string {
  return `## Workflow step ${i} of ${n}

${prompt}

If the step above names a slash command or skill (e.g. /some-skill), invoke it with the Skill tool. Work in the current repository; the issue description says what to work on.

When the step is finished, hand off by calling:
  workshop_transition_issue("<issue id>", "${next}", "<one-line summary>", { previousStep: "<what you produced: findings, decisions, file paths>" })`;
}

function gate(state: string, approve: string, reject: string, autoApprovable: boolean): StageDefinition {
  return {
    state,
    semanticRole: 'human-gate',
    agentActionable: false,
    humanGate: true,
    autoApprovable,
    validTransitions: [
      { to: approve, trigger: 'human-approve' },
      { to: reject, trigger: 'human-reject' },
    ],
  };
}

export function buildSkillChainStages(steps: ChainStep[]): StageDefinition[] {
  if (steps.length === 0) throw new Error('A skill chain needs at least one step');
  if (steps.length > MAX_CHAIN_STEPS) throw new Error(`A skill chain can have at most ${MAX_CHAIN_STEPS} steps`);
  if (steps.some((s) => !s.prompt.trim())) throw new Error('Every step needs a prompt');

  const n = steps.length;
  const stages: StageDefinition[] = [];
  steps.forEach((step, idx) => {
    const i = idx + 1;
    const after = step.pauseAfter ? `pause-${i}` : i < n ? `step-${i + 1}` : 'final-review';
    stages.push({
      state: `step-${i}`,
      semanticRole: i === 1 ? 'entry' : 'processing',
      agentActionable: true,
      humanGate: false,
      validTransitions: [{ to: after, trigger: 'agent-complete' }],
      promptOverride: stepPrompt(i, n, step.prompt.trim(), after),
    });
    if (step.pauseAfter) {
      stages.push(gate(`pause-${i}`, i < n ? `step-${i + 1}` : 'final-review', `step-${i}`, false));
    }
  });
  stages.push(gate('final-review', 'done', `step-${n}`, true));
  stages.push({ state: 'done', semanticRole: 'terminal', agentActionable: false, humanGate: false, validTransitions: [] });
  return stages;
}
