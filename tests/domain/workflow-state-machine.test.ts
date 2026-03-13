import { describe, it, expect } from 'vitest';
import {
  getStageDefinition,
  isValidTransition,
  isHumanGate,
  isTerminal,
  isAgentActionable,
  getStatesForType,
  getInitialState,
  EPIC_STAGES,
  TASK_STAGES,
} from '@domain/workflow/state-machine';

describe('workflow state machine', () => {
  // ---------------------------------------------------------------------------
  // EPIC_STAGES
  // ---------------------------------------------------------------------------
  describe('EPIC_STAGES', () => {
    it('should define 18 stages (including cancelled, merged)', () => {
      expect(EPIC_STAGES).toHaveLength(18);
    });

    it('all stages should have ticketType epic', () => {
      expect(EPIC_STAGES.every((s) => s.ticketType === 'epic')).toBe(true);
    });

    it('terminal states (merged, cancelled) should have no valid transitions', () => {
      const merged = EPIC_STAGES.find((s) => s.state === 'merged');
      const cancelled = EPIC_STAGES.find((s) => s.state === 'cancelled');
      expect(merged!.validTransitions).toHaveLength(0);
      expect(cancelled!.validTransitions).toHaveLength(0);
    });

    it('human gate states (spec-review, plan-review, final-review) should have humanGate=true', () => {
      for (const name of ['spec-review', 'plan-review', 'final-review'] as const) {
        const stage = EPIC_STAGES.find((s) => s.state === name);
        expect(stage!.humanGate).toBe(true);
      }
    });

    it('agent-actionable states should have agentRole defined', () => {
      for (const stage of EPIC_STAGES) {
        if (stage.agentActionable) {
          expect(stage.agentRole).toBeDefined();
        }
      }
    });

    it('planning should have agentCount=3 and parallel=true', () => {
      const planning = EPIC_STAGES.find((s) => s.state === 'planning');
      expect(planning!.agentCount).toBe(3);
      expect(planning!.parallel).toBe(true);
    });

    it('plan-critique should have agentCount=2 and parallel=true', () => {
      const planCritique = EPIC_STAGES.find((s) => s.state === 'plan-critique');
      expect(planCritique!.agentCount).toBe(2);
      expect(planCritique!.parallel).toBe(true);
    });

    it('integration-review should have agentCount=2 and parallel=true', () => {
      const integrationReview = EPIC_STAGES.find((s) => s.state === 'integration-review');
      expect(integrationReview!.agentCount).toBe(2);
      expect(integrationReview!.parallel).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // TASK_STAGES
  // ---------------------------------------------------------------------------
  describe('TASK_STAGES', () => {
    it('should define 7 stages', () => {
      expect(TASK_STAGES).toHaveLength(7);
    });

    it('all stages should have ticketType task', () => {
      expect(TASK_STAGES.every((s) => s.ticketType === 'task')).toBe(true);
    });

    it('terminal states (done, cancelled) should have no valid transitions', () => {
      const done = TASK_STAGES.find((s) => s.state === 'done');
      const cancelled = TASK_STAGES.find((s) => s.state === 'cancelled');
      expect(done!.validTransitions).toHaveLength(0);
      expect(cancelled!.validTransitions).toHaveLength(0);
    });

    it('no task states should be human gates', () => {
      expect(TASK_STAGES.every((s) => s.humanGate === false)).toBe(true);
    });

    it('in-progress should have agentRole implementer', () => {
      const inProgress = TASK_STAGES.find((s) => s.state === 'in-progress');
      expect(inProgress!.agentRole).toBe('implementer');
    });

    it('code-review should have agentRole code-reviewer', () => {
      const codeReview = TASK_STAGES.find((s) => s.state === 'code-review');
      expect(codeReview!.agentRole).toBe('code-reviewer');
    });
  });

  // ---------------------------------------------------------------------------
  // getStageDefinition
  // ---------------------------------------------------------------------------
  describe('getStageDefinition', () => {
    it('returns correct definition for epic:idea', () => {
      const def = getStageDefinition('epic', 'idea');
      expect(def).toBeDefined();
      expect(def!.state).toBe('idea');
      expect(def!.ticketType).toBe('epic');
    });

    it('returns correct definition for task:ready', () => {
      const def = getStageDefinition('task', 'ready');
      expect(def).toBeDefined();
      expect(def!.state).toBe('ready');
      expect(def!.ticketType).toBe('task');
      expect(def!.agentRole).toBe('implementer');
    });

    it('returns undefined for invalid combinations (e.g., task:planning)', () => {
      expect(getStageDefinition('task', 'planning')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // isValidTransition
  // ---------------------------------------------------------------------------
  describe('isValidTransition', () => {
    // Epic transitions
    it('epic: idea -> triaging is valid', () => {
      expect(isValidTransition('epic', 'idea', 'triaging')).toBe(true);
    });

    it('epic: idea -> merged is NOT valid', () => {
      expect(isValidTransition('epic', 'idea', 'merged')).toBe(false);
    });

    it('epic: triaging -> needs-input is valid', () => {
      expect(isValidTransition('epic', 'triaging', 'needs-input')).toBe(true);
    });

    it('epic: triaging -> specced is valid', () => {
      expect(isValidTransition('epic', 'triaging', 'specced')).toBe(true);
    });

    it('epic: spec-review -> planning is valid (approve)', () => {
      expect(isValidTransition('epic', 'spec-review', 'planning')).toBe(true);
    });

    it('epic: spec-review -> triaging is valid (reject)', () => {
      expect(isValidTransition('epic', 'spec-review', 'triaging')).toBe(true);
    });

    it('epic: spec-review -> merged is NOT valid', () => {
      expect(isValidTransition('epic', 'spec-review', 'merged')).toBe(false);
    });

    it('epic: planning -> plan-critique is valid', () => {
      expect(isValidTransition('epic', 'planning', 'plan-critique')).toBe(true);
    });

    it('epic: plan-critique -> plan-review is valid (no blocking)', () => {
      expect(isValidTransition('epic', 'plan-critique', 'plan-review')).toBe(true);
    });

    it('epic: plan-critique -> planning is valid (blocking findings)', () => {
      expect(isValidTransition('epic', 'plan-critique', 'planning')).toBe(true);
    });

    it('epic: plan-review -> executing is valid (approve)', () => {
      expect(isValidTransition('epic', 'plan-review', 'executing')).toBe(true);
    });

    it('epic: executing -> integration-review is valid (execution-complete)', () => {
      expect(isValidTransition('epic', 'executing', 'integration-review')).toBe(true);
    });

    it('epic: executing -> execution-failed is valid', () => {
      expect(isValidTransition('epic', 'executing', 'execution-failed')).toBe(true);
    });

    it('epic: execution-failed -> executing is valid (retry)', () => {
      expect(isValidTransition('epic', 'execution-failed', 'executing')).toBe(true);
    });

    it('epic: execution-failed -> planning is valid (rework)', () => {
      expect(isValidTransition('epic', 'execution-failed', 'planning')).toBe(true);
    });

    it('epic: in-progress -> integration-review is valid', () => {
      expect(isValidTransition('epic', 'in-progress', 'integration-review')).toBe(true);
    });

    // Task transitions
    it('task: blocked -> ready is valid', () => {
      expect(isValidTransition('task', 'blocked', 'ready')).toBe(true);
    });

    it('task: ready -> in-progress is valid', () => {
      expect(isValidTransition('task', 'ready', 'in-progress')).toBe(true);
    });

    it('task: in-progress -> code-review is valid', () => {
      expect(isValidTransition('task', 'in-progress', 'code-review')).toBe(true);
    });

    it('task: code-review -> done is valid', () => {
      expect(isValidTransition('task', 'code-review', 'done')).toBe(true);
    });

    it('task: code-review -> changes-requested is valid', () => {
      expect(isValidTransition('task', 'code-review', 'changes-requested')).toBe(true);
    });

    // Cancelled from any non-terminal state
    it('any non-terminal state -> cancelled is valid', () => {
      expect(isValidTransition('epic', 'idea', 'cancelled')).toBe(true);
      expect(isValidTransition('epic', 'triaging', 'cancelled')).toBe(true);
      expect(isValidTransition('task', 'blocked', 'cancelled')).toBe(true);
      expect(isValidTransition('task', 'in-progress', 'cancelled')).toBe(true);
    });

    // Terminal states cannot transition
    it('merged -> anything is NOT valid', () => {
      expect(isValidTransition('epic', 'merged', 'idea')).toBe(false);
      expect(isValidTransition('epic', 'merged', 'cancelled')).toBe(false);
    });

    it('cancelled -> anything is NOT valid', () => {
      expect(isValidTransition('epic', 'cancelled', 'idea')).toBe(false);
      expect(isValidTransition('task', 'cancelled', 'ready')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // isHumanGate
  // ---------------------------------------------------------------------------
  describe('isHumanGate', () => {
    it('spec-review returns true', () => {
      expect(isHumanGate('spec-review')).toBe(true);
    });

    it('plan-review returns true', () => {
      expect(isHumanGate('plan-review')).toBe(true);
    });

    it('final-review returns true', () => {
      expect(isHumanGate('final-review')).toBe(true);
    });

    it('triaging returns false', () => {
      expect(isHumanGate('triaging')).toBe(false);
    });

    it('planning returns false', () => {
      expect(isHumanGate('planning')).toBe(false);
    });

    it('in-progress returns false', () => {
      expect(isHumanGate('in-progress')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // isTerminal
  // ---------------------------------------------------------------------------
  describe('isTerminal', () => {
    it('epic: merged is terminal', () => {
      expect(isTerminal('epic', 'merged')).toBe(true);
    });

    it('epic: cancelled is terminal', () => {
      expect(isTerminal('epic', 'cancelled')).toBe(true);
    });

    it('epic: idea is NOT terminal', () => {
      expect(isTerminal('epic', 'idea')).toBe(false);
    });

    it('task: done is terminal', () => {
      expect(isTerminal('task', 'done')).toBe(true);
    });

    it('task: cancelled is terminal', () => {
      expect(isTerminal('task', 'cancelled')).toBe(true);
    });

    it('task: ready is NOT terminal', () => {
      expect(isTerminal('task', 'ready')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // isAgentActionable
  // ---------------------------------------------------------------------------
  describe('isAgentActionable', () => {
    it('triaging is agent-actionable', () => {
      expect(isAgentActionable('epic', 'triaging')).toBe(true);
    });

    it('planning is agent-actionable', () => {
      expect(isAgentActionable('epic', 'planning')).toBe(true);
    });

    it('plan-critique is agent-actionable', () => {
      expect(isAgentActionable('epic', 'plan-critique')).toBe(true);
    });

    it('splitting is agent-actionable', () => {
      expect(isAgentActionable('epic', 'splitting')).toBe(true);
    });

    it('integration-review is agent-actionable', () => {
      expect(isAgentActionable('epic', 'integration-review')).toBe(true);
    });

    it('integration-fix is agent-actionable', () => {
      expect(isAgentActionable('epic', 'integration-fix')).toBe(true);
    });

    it('spec-review is NOT agent-actionable', () => {
      expect(isAgentActionable('epic', 'spec-review')).toBe(false);
    });

    it('needs-input is NOT agent-actionable', () => {
      expect(isAgentActionable('epic', 'needs-input')).toBe(false);
    });

    it('idea is NOT agent-actionable', () => {
      expect(isAgentActionable('epic', 'idea')).toBe(false);
    });

    it('task in-progress is agent-actionable', () => {
      expect(isAgentActionable('task', 'in-progress')).toBe(true);
    });

    it('task code-review is agent-actionable', () => {
      expect(isAgentActionable('task', 'code-review')).toBe(true);
    });

    it('task blocked is NOT agent-actionable', () => {
      expect(isAgentActionable('task', 'blocked')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getStatesForType
  // ---------------------------------------------------------------------------
  describe('getStatesForType', () => {
    it('epic returns 18 states', () => {
      expect(getStatesForType('epic')).toHaveLength(18);
    });

    it('task returns 7 states', () => {
      expect(getStatesForType('task')).toHaveLength(7);
    });

    it('both include cancelled', () => {
      expect(getStatesForType('epic')).toContain('cancelled');
      expect(getStatesForType('task')).toContain('cancelled');
    });
  });

  // ---------------------------------------------------------------------------
  // getInitialState
  // ---------------------------------------------------------------------------
  describe('getInitialState', () => {
    it('epic initial state is idea', () => {
      expect(getInitialState('epic')).toBe('idea');
    });

    it('task initial state is ready', () => {
      expect(getInitialState('task')).toBe('ready');
    });
  });
});
