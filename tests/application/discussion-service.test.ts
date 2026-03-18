import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDiscussionService } from '../../src/application/discussion/discussion-service.js';
import type { DiscussionServiceDeps } from '../../src/application/discussion/discussion-service.js';
import type { DiscussionTeamId, DiscussionId, DiscussionTeam, Discussion, ConsensusRule } from '../../src/foundation/discussion-types.js';
import type { AgentId, TrackId, SessionId } from '../../src/foundation/types.js';

// Helper to create mock deps
function createMockDeps(): DiscussionServiceDeps {
  const teamData: DiscussionTeam = {
    id: 'team-1' as DiscussionTeamId,
    name: 'Test Team',
    consensusRule: { type: 'unanimous' } as ConsensusRule,
    memberAgentIds: ['agent-a' as AgentId, 'agent-b' as AgentId],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    teams: {
      findAll: vi.fn().mockReturnValue([teamData]),
      findById: vi.fn().mockReturnValue(teamData),
      create: vi.fn().mockImplementation((data) => ({ id: 'team-new' as DiscussionTeamId, ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })),
      update: vi.fn().mockImplementation((id, data) => ({ ...teamData, ...data, id })),
      delete: vi.fn().mockReturnValue(true),
    },
    discussions: {
      findAll: vi.fn().mockReturnValue([]),
      findById: vi.fn().mockReturnValue(null),
      create: vi.fn().mockImplementation((data) => ({
        id: 'disc-1' as DiscussionId,
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      updateStatus: vi.fn().mockImplementation((id, status) => ({ id, status })),
      updateLastActivity: vi.fn(),
      update: vi.fn(),
      delete: vi.fn().mockReturnValue(true),
    },
    messages: {
      findByDiscussion: vi.fn().mockReturnValue([]),
      findById: vi.fn().mockReturnValue(null),
      findAfter: vi.fn().mockReturnValue([]),
      create: vi.fn().mockImplementation((data) => ({
        id: 'msg-1',
        ...data,
        createdAt: new Date().toISOString(),
      })),
      countByDiscussion: vi.fn().mockReturnValue(0),
      latestRowid: vi.fn().mockReturnValue(null),
    },
    votes: {
      findByDiscussion: vi.fn().mockReturnValue([]),
      upsert: vi.fn().mockImplementation((vote) => ({ ...vote, createdAt: new Date().toISOString() })),
      findByVoter: vi.fn().mockReturnValue(null),
    },
    discussionSessions: {
      findByDiscussion: vi.fn().mockReturnValue([]),
      findByAgent: vi.fn().mockReturnValue([]),
      create: vi.fn().mockImplementation((data) => data),
      updateLastSeen: vi.fn(),
      deleteByDiscussion: vi.fn(),
      findWithUnread: vi.fn().mockReturnValue([]),
    },
    agents: {
      findAll: vi.fn().mockReturnValue([]),
      findById: vi.fn().mockReturnValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    filesystemScanner: {
      scanGlobalAgents: vi.fn().mockReturnValue([]),
      scanProjectAgents: vi.fn().mockReturnValue([]),
      scanAll: vi.fn().mockReturnValue([]),
      findById: vi.fn().mockImplementation((id: string) => ({
        id,
        name: id.replace(/.*:/, ''),
        description: 'Test agent',
        systemPrompt: 'You are a test agent.',
        source: 'global' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
    },
    sessions: {
      findById: vi.fn().mockReturnValue(null),
      findByTrack: vi.fn().mockReturnValue([]),
      findByTmuxSession: vi.fn().mockReturnValue(null),
      findAll: vi.fn().mockReturnValue([]),
      create: vi.fn(),
      updateState: vi.fn(),
      updateName: vi.fn(),
      updateClaudeResumeId: vi.fn(),
      delete: vi.fn(),
    },
    tracks: {
      findAll: vi.fn().mockReturnValue([]),
      findById: vi.fn().mockReturnValue(null),
      create: vi.fn().mockImplementation((data) => ({ id: 'track-disc' as TrackId, ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })),
      update: vi.fn(),
      delete: vi.fn(),
      findReposByTrack: vi.fn().mockReturnValue([]),
      addRepo: vi.fn(),
      removeRepo: vi.fn(),
      findPathsByTrack: vi.fn().mockReturnValue([]),
      addPath: vi.fn(),
      removePath: vi.fn(),
      getTerminalLayout: vi.fn(),
      setTerminalLayout: vi.fn(),
      setDefaultPromptTemplate: vi.fn(),
    } as any,
    summaries: {
      findLatest: vi.fn().mockReturnValue(null),
      findByTrack: vi.fn().mockReturnValue([]),
      create: vi.fn(),
    } as any,
    terminal: {
      createSession: vi.fn().mockResolvedValue({
        id: 'session-1' as SessionId,
        trackId: 'track-disc' as TrackId,
        tmuxSession: 'workshop-test',
        state: 'active',
      }),
      destroySession: vi.fn().mockResolvedValue(undefined),
    },
    projectRoot: '/tmp/test',
    broadcast: vi.fn(),
  };
}

describe('DiscussionService', () => {
  let deps: DiscussionServiceDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  describe('createTeam', () => {
    it('delegates to team repository', () => {
      const service = createDiscussionService(deps);
      service.createTeam({
        name: 'Test',
        consensusRule: { type: 'unanimous' },
        memberAgentIds: ['a' as AgentId],
      });
      expect(deps.teams.create).toHaveBeenCalled();
    });
  });

  describe('createDiscussion', () => {
    it('creates discussion and spawns agent sessions', async () => {
      const service = createDiscussionService(deps);
      const result = await service.createDiscussion({
        teamId: 'team-1' as DiscussionTeamId,
        title: 'Test Discussion',
      });

      expect(deps.discussions.create).toHaveBeenCalled();
      expect(deps.terminal.createSession).toHaveBeenCalledTimes(2); // 2 agents in team
      expect(deps.discussionSessions.create).toHaveBeenCalledTimes(2);
      expect(deps.broadcast).toHaveBeenCalledWith('discussion:created', expect.any(String));
    });

    it('throws when team not found', async () => {
      (deps.teams.findById as any).mockReturnValue(null);
      const service = createDiscussionService(deps);
      await expect(
        service.createDiscussion({ teamId: 'bad-id' as DiscussionTeamId, title: 'Test' }),
      ).rejects.toThrow('Team not found');
    });

    it('posts initial proposal when artifact provided', async () => {
      const service = createDiscussionService(deps);
      await service.createDiscussion({
        teamId: 'team-1' as DiscussionTeamId,
        title: 'Test',
        artifact: 'Some proposal text',
      });
      expect(deps.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({ messageType: 'proposal', content: 'Some proposal text' }),
      );
    });

    it('marks discussion as failed when all agent sessions fail', async () => {
      (deps.terminal.createSession as any).mockRejectedValue(new Error('spawn failed'));
      const service = createDiscussionService(deps);
      const result = await service.createDiscussion({
        teamId: 'team-1' as DiscussionTeamId,
        title: 'Test',
      });
      expect(deps.discussions.updateStatus).toHaveBeenCalledWith(expect.any(String), 'failed');
    });
  });

  describe('postMessage', () => {
    it('creates message and broadcasts', () => {
      const discussion = {
        id: 'disc-1' as DiscussionId,
        status: 'open' as const,
        participantIds: ['agent-a'],
      };
      (deps.discussions.findById as any).mockReturnValue(discussion);

      const service = createDiscussionService(deps);
      service.postMessage('disc-1' as DiscussionId, {
        authorType: 'agent',
        authorId: 'agent-a',
        authorName: 'Agent A',
        messageType: 'comment',
        content: 'Hello',
      });

      expect(deps.messages.create).toHaveBeenCalled();
      expect(deps.discussions.updateLastActivity).toHaveBeenCalled();
      expect(deps.broadcast).toHaveBeenCalledWith('discussion:message', 'disc-1');
    });

    it('rejects post from non-participant', () => {
      const discussion = {
        id: 'disc-1' as DiscussionId,
        status: 'open' as const,
        participantIds: ['agent-a'],
      };
      (deps.discussions.findById as any).mockReturnValue(discussion);

      const service = createDiscussionService(deps);
      expect(() =>
        service.postMessage('disc-1' as DiscussionId, {
          authorType: 'agent',
          authorId: 'agent-x',
          messageType: 'comment',
          content: 'Hi',
        }),
      ).toThrow('not a participant');
    });

    it('rejects post to closed discussion', () => {
      (deps.discussions.findById as any).mockReturnValue({
        id: 'disc-1',
        status: 'closed',
        participantIds: ['agent-a'],
      });

      const service = createDiscussionService(deps);
      expect(() =>
        service.postMessage('disc-1' as DiscussionId, {
          authorType: 'agent',
          authorId: 'agent-a',
          messageType: 'comment',
          content: 'Hi',
        }),
      ).toThrow('not open');
    });
  });

  describe('castVote', () => {
    it('upserts vote and checks consensus', async () => {
      const discussion = {
        id: 'disc-1' as DiscussionId,
        teamId: 'team-1' as DiscussionTeamId,
        status: 'open' as const,
        participantIds: ['agent-a', 'agent-b'],
      };
      (deps.discussions.findById as any).mockReturnValue(discussion);

      const service = createDiscussionService(deps);
      await service.castVote('disc-1' as DiscussionId, {
        voterType: 'agent',
        voterId: 'agent-a',
        vote: 'satisfied',
      });

      expect(deps.votes.upsert).toHaveBeenCalled();
      expect(deps.broadcast).toHaveBeenCalledWith('discussion:vote', 'disc-1');
    });

    it('rejects vote from non-participant', async () => {
      (deps.discussions.findById as any).mockReturnValue({
        id: 'disc-1',
        status: 'open',
        participantIds: ['agent-a'],
      });

      const service = createDiscussionService(deps);
      await expect(
        service.castVote('disc-1' as DiscussionId, {
          voterType: 'agent',
          voterId: 'agent-x',
          vote: 'satisfied',
        }),
      ).rejects.toThrow('not a participant');
    });

    it('auto-closes on consensus', async () => {
      const discussion = {
        id: 'disc-1' as DiscussionId,
        teamId: 'team-1' as DiscussionTeamId,
        status: 'open' as const,
        participantIds: ['agent-a', 'agent-b'],
      };
      (deps.discussions.findById as any).mockReturnValue(discussion);

      // Both agents voted satisfied -> unanimous consensus
      (deps.votes.findByDiscussion as any).mockReturnValue([
        { voterId: 'agent-a', vote: 'satisfied' },
        { voterId: 'agent-b', vote: 'satisfied' },
      ]);

      const service = createDiscussionService(deps);
      await service.castVote('disc-1' as DiscussionId, {
        voterType: 'agent',
        voterId: 'agent-b',
        vote: 'satisfied',
      });

      expect(deps.discussions.updateStatus).toHaveBeenCalledWith('disc-1', 'consensus');
      expect(deps.broadcast).toHaveBeenCalledWith('discussion:consensus', 'disc-1');
    });
  });

  describe('closeDiscussion', () => {
    it('destroys agent sessions and broadcasts', async () => {
      (deps.discussions.findById as any).mockReturnValue({
        id: 'disc-1',
        status: 'open',
      });
      (deps.discussionSessions.findByDiscussion as any).mockReturnValue([
        { sessionId: 'session-1' as SessionId, agentId: 'agent-a' },
      ]);
      (deps.sessions.findById as any).mockReturnValue({ id: 'session-1' });

      const service = createDiscussionService(deps);
      await service.closeDiscussion('disc-1' as DiscussionId);

      expect(deps.terminal.destroySession).toHaveBeenCalledWith('session-1');
      expect(deps.discussionSessions.deleteByDiscussion).toHaveBeenCalledWith('disc-1');
      expect(deps.broadcast).toHaveBeenCalledWith('discussion:closed', 'disc-1');
    });
  });

  describe('getDiscussionState', () => {
    it('returns null for nonexistent discussion', () => {
      const service = createDiscussionService(deps);
      expect(service.getDiscussionState('bad-id' as DiscussionId)).toBeNull();
    });

    it('returns full state for existing discussion', () => {
      const discussion = {
        id: 'disc-1' as DiscussionId,
        teamId: 'team-1' as DiscussionTeamId,
        status: 'open' as const,
        participantIds: ['agent-a', 'agent-b'],
      };
      (deps.discussions.findById as any).mockReturnValue(discussion);
      (deps.messages.findByDiscussion as any).mockReturnValue([]);
      (deps.votes.findByDiscussion as any).mockReturnValue([]);

      const service = createDiscussionService(deps);
      const state = service.getDiscussionState('disc-1' as DiscussionId);

      expect(state).not.toBeNull();
      expect(state!.discussion).toBe(discussion);
      expect(state!.participantCount).toBe(2);
      expect(state!.votedCount).toBe(0);
      expect(state!.satisfiedCount).toBe(0);
      expect(state!.consensusMet).toBe(false);
    });
  });
});
