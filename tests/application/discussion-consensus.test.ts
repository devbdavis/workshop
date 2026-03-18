import { describe, it, expect } from 'vitest';
import { evaluateConsensus } from '../../src/application/discussion/discussion-service.js';
import type { ConsensusRule, DiscussionVote, DiscussionId } from '../../src/foundation/discussion-types.js';

function makeVote(voterId: string, vote: 'satisfied' | 'unsatisfied' | 'abstain'): DiscussionVote {
  return {
    discussionId: 'disc-1' as DiscussionId,
    voterType: 'agent',
    voterId,
    vote,
    createdAt: new Date().toISOString(),
  };
}

describe('evaluateConsensus', () => {
  const participants = ['agent-a', 'agent-b', 'agent-c'];

  describe('unanimous', () => {
    const rule: ConsensusRule = { type: 'unanimous' };

    it('returns true when all participants vote satisfied', () => {
      const votes = [
        makeVote('agent-a', 'satisfied'),
        makeVote('agent-b', 'satisfied'),
        makeVote('agent-c', 'satisfied'),
      ];
      expect(evaluateConsensus(rule, participants, votes)).toBe(true);
    });

    it('returns false when one votes unsatisfied', () => {
      const votes = [
        makeVote('agent-a', 'satisfied'),
        makeVote('agent-b', 'unsatisfied'),
        makeVote('agent-c', 'satisfied'),
      ];
      expect(evaluateConsensus(rule, participants, votes)).toBe(false);
    });

    it('returns false when one abstains (abstention blocks unanimity)', () => {
      const votes = [
        makeVote('agent-a', 'satisfied'),
        makeVote('agent-b', 'abstain'),
        makeVote('agent-c', 'satisfied'),
      ];
      expect(evaluateConsensus(rule, participants, votes)).toBe(false);
    });

    it('returns false when not all participants have voted', () => {
      const votes = [
        makeVote('agent-a', 'satisfied'),
        makeVote('agent-b', 'satisfied'),
      ];
      expect(evaluateConsensus(rule, participants, votes)).toBe(false);
    });

    it('returns false with no votes', () => {
      expect(evaluateConsensus(rule, participants, [])).toBe(false);
    });

    it('returns false with empty participants', () => {
      expect(evaluateConsensus(rule, [], [])).toBe(false);
    });

    it('returns true with single participant voting satisfied', () => {
      const votes = [makeVote('agent-a', 'satisfied')];
      expect(evaluateConsensus(rule, ['agent-a'], votes)).toBe(true);
    });
  });

  describe('majority', () => {
    const rule: ConsensusRule = { type: 'majority', threshold: 0.5 };

    it('returns true when satisfied ratio meets threshold', () => {
      const votes = [
        makeVote('agent-a', 'satisfied'),
        makeVote('agent-b', 'unsatisfied'),
        makeVote('agent-c', 'satisfied'),
      ];
      // 2/3 = 0.667 >= 0.5
      expect(evaluateConsensus(rule, participants, votes)).toBe(true);
    });

    it('returns true when exactly at threshold', () => {
      const twoParticipants = ['agent-a', 'agent-b'];
      const votes = [makeVote('agent-a', 'satisfied')];
      // 1/2 = 0.5 >= 0.5
      expect(evaluateConsensus(rule, twoParticipants, votes)).toBe(true);
    });

    it('returns false when below threshold', () => {
      const highThreshold: ConsensusRule = { type: 'majority', threshold: 0.75 };
      const votes = [
        makeVote('agent-a', 'satisfied'),
        makeVote('agent-b', 'unsatisfied'),
      ];
      // 1/3 = 0.333 < 0.75
      expect(evaluateConsensus(highThreshold, participants, votes)).toBe(false);
    });

    it('abstentions count against (lower satisfied ratio)', () => {
      const votes = [
        makeVote('agent-a', 'satisfied'),
        makeVote('agent-b', 'abstain'),
      ];
      // 1/3 = 0.333 < 0.5
      expect(evaluateConsensus(rule, participants, votes)).toBe(false);
    });

    it('returns false with no votes', () => {
      expect(evaluateConsensus(rule, participants, [])).toBe(false);
    });

    it('returns false with empty participants', () => {
      expect(evaluateConsensus(rule, [], [])).toBe(false);
    });
  });

  describe('quorum', () => {
    const rule: ConsensusRule = { type: 'quorum', minVotes: 2 };

    it('returns true when enough votes and satisfied > unsatisfied', () => {
      const votes = [
        makeVote('agent-a', 'satisfied'),
        makeVote('agent-b', 'satisfied'),
      ];
      expect(evaluateConsensus(rule, participants, votes)).toBe(true);
    });

    it('returns false when not enough votes', () => {
      const votes = [makeVote('agent-a', 'satisfied')];
      expect(evaluateConsensus(rule, participants, votes)).toBe(false);
    });

    it('returns false when satisfied <= unsatisfied', () => {
      const votes = [
        makeVote('agent-a', 'satisfied'),
        makeVote('agent-b', 'unsatisfied'),
      ];
      // satisfied (1) NOT > unsatisfied (1)
      expect(evaluateConsensus(rule, participants, votes)).toBe(false);
    });

    it('abstentions count toward quorum but not toward satisfied', () => {
      const votes = [
        makeVote('agent-a', 'satisfied'),
        makeVote('agent-b', 'abstain'),
      ];
      // 2 votes >= minVotes(2), satisfied(1) > unsatisfied(0)
      expect(evaluateConsensus(rule, participants, votes)).toBe(true);
    });

    it('returns false with no votes', () => {
      expect(evaluateConsensus(rule, participants, [])).toBe(false);
    });

    it('returns false with empty participants', () => {
      expect(evaluateConsensus(rule, [], [])).toBe(false);
    });
  });
});
