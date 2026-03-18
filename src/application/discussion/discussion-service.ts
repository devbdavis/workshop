import type {
  Discussion,
  DiscussionId,
  DiscussionMessage,
  DiscussionTeam,
  DiscussionTeamId,
  DiscussionVote,
  DiscussionStatus,
  ConsensusRule,
} from '@foundation/discussion-types';
import type { AgentId, SessionId, SessionProvider, TrackId } from '@foundation/types';
import type {
  DiscussionTeamRepository,
  DiscussionRepository,
  DiscussionMessageRepository,
  DiscussionVoteRepository,
  DiscussionSessionRepository,
} from '@domain/discussion/repository';
import type { AgentRepository } from '@domain/agent/repository';
import type { TrackRepository } from '@domain/track/repository';
import type { SummaryRepository } from '@domain/summary/repository';
import type { SessionRepository } from '@domain/session/repository';
import type { FilesystemAgentScanner } from '@infrastructure/agents/filesystem-scanner.js';
import { buildGovernancePrompt } from './governance-prompt.js';
import { resolveProvider } from './provider-mapping.js';

export interface DiscussionServiceDeps {
  teams: DiscussionTeamRepository;
  discussions: DiscussionRepository;
  messages: DiscussionMessageRepository;
  votes: DiscussionVoteRepository;
  discussionSessions: DiscussionSessionRepository;
  agents: AgentRepository;
  filesystemScanner: FilesystemAgentScanner;
  sessions: SessionRepository;
  tracks: TrackRepository;
  summaries: SummaryRepository;
  terminal: {
    createSession: (
      trackId: TrackId,
      opts?: {
        systemPrompt?: string;
        workingDirectory?: string;
        background?: boolean;
        initialPrompt?: string;
        provider?: SessionProvider;
      },
    ) => Promise<{ id: SessionId; trackId: TrackId; tmuxSession: string; state: string }>;
    destroySession: (sessionId: SessionId) => Promise<void>;
  };
  projectRoot: string;
  broadcast: (type: string, id: string) => void;
}

export interface CreateDiscussionInput {
  teamId: DiscussionTeamId;
  title: string;
  type?: 'rfc' | 'question' | 'review';
  artifact?: string;
  trackId?: TrackId;
  createdByType?: 'agent' | 'human';
  createdById?: string;
  staleAfterMinutes?: number;
}

export interface PostMessageInput {
  authorType: 'agent' | 'human';
  authorId?: string;
  authorName?: string;
  messageType: 'proposal' | 'comment' | 'suggestion' | 'objection' | 'revision' | 'satisfied' | 'unsatisfied';
  content: string;
}

export interface CastVoteInput {
  voterType: 'agent' | 'human';
  voterId: string;
  voterName?: string;
  vote: 'satisfied' | 'unsatisfied' | 'abstain';
  comment?: string;
}

export interface DiscussionState {
  discussion: Discussion;
  messages: DiscussionMessage[];
  votes: DiscussionVote[];
  consensusMet: boolean;
  participantCount: number;
  votedCount: number;
  satisfiedCount: number;
}

export interface DiscussionService {
  // Team management
  createTeam(data: Omit<DiscussionTeam, 'id' | 'createdAt' | 'updatedAt'>): DiscussionTeam;
  updateTeam(id: DiscussionTeamId, data: Partial<Pick<DiscussionTeam, 'name' | 'description' | 'consensusRule' | 'memberAgentIds'>>): DiscussionTeam | null;
  deleteTeam(id: DiscussionTeamId): boolean;

  // Discussion lifecycle
  createDiscussion(data: CreateDiscussionInput): Promise<Discussion>;
  postMessage(discussionId: DiscussionId, data: PostMessageInput): DiscussionMessage;
  castVote(discussionId: DiscussionId, data: CastVoteInput): Promise<DiscussionVote>;
  closeDiscussion(discussionId: DiscussionId): Promise<void>;
  getDiscussionState(discussionId: DiscussionId): DiscussionState | null;
}

export function createDiscussionService(deps: DiscussionServiceDeps): DiscussionService {
  let discussionsTrackId: TrackId | null = null;

  function getOrCreateDiscussionsTrack(): TrackId {
    if (discussionsTrackId) {
      const existing = deps.tracks.findById(discussionsTrackId);
      if (existing) return discussionsTrackId;
    }
    const all = deps.tracks.findAll();
    const existing = all.find((t) => t.name === '_Discussions');
    if (existing) {
      discussionsTrackId = existing.id;
      return existing.id;
    }
    const track = deps.tracks.create({
      name: '_Discussions',
      description: 'System track for discussion agent sessions',
      status: 'active',
    });
    discussionsTrackId = track.id;
    return track.id;
  }

  function resolveAgent(agentId: AgentId) {
    return deps.agents.findById(agentId) || deps.filesystemScanner.findById(agentId, deps.projectRoot);
  }

  function checkConsensus(discussion: Discussion, votes: DiscussionVote[]): boolean {
    const team = deps.teams.findById(discussion.teamId);
    if (!team) return false;
    const rule = team.consensusRule;
    const participants = discussion.participantIds;
    return evaluateConsensus(rule, participants, votes);
  }

  return {
    createTeam(data) {
      return deps.teams.create(data);
    },

    updateTeam(id, data) {
      return deps.teams.update(id, data);
    },

    deleteTeam(id) {
      return deps.teams.delete(id);
    },

    async createDiscussion(data) {
      const team = deps.teams.findById(data.teamId);
      if (!team) throw new Error(`Team not found: ${data.teamId}`);

      const trackId = getOrCreateDiscussionsTrack();
      const now = new Date().toISOString();

      // Lock participant list from team members
      const participantIds = [...team.memberAgentIds];

      const discussion = deps.discussions.create({
        teamId: data.teamId,
        title: data.title,
        type: data.type || 'rfc',
        status: 'open',
        artifact: data.artifact,
        trackId: data.trackId,
        createdByType: data.createdByType || 'human',
        createdById: data.createdById,
        participantIds,
        staleAfterMinutes: data.staleAfterMinutes ?? 0,
        closedAt: undefined,
        lastActivityAt: now,
      });

      // Post initial proposal message if there's an artifact
      if (data.artifact) {
        deps.messages.create({
          discussionId: discussion.id,
          authorType: data.createdByType || 'human',
          authorId: data.createdById,
          authorName: data.createdById || 'Creator',
          messageType: 'proposal',
          content: data.artifact,
        });
      }

      // Spawn agent sessions
      let spawnedCount = 0;
      for (const agentId of participantIds) {
        try {
          const agent = resolveAgent(agentId as AgentId);
          if (!agent) {
            console.warn(`Discussion ${discussion.id}: agent ${agentId} not found, skipping`);
            continue;
          }

          // Compose system prompt
          const parts: string[] = [];
          if (agent.systemPrompt) {
            parts.push(`## Agent: ${agent.name}\n\n${agent.systemPrompt}`);
          }

          // Track context if bound
          if (data.trackId) {
            const boundTrack = deps.tracks.findById(data.trackId);
            if (boundTrack?.context) {
              parts.push(boundTrack.context);
            }
            const summary = deps.summaries.findLatest(data.trackId);
            if (summary) {
              parts.push(`## Current Status\n\n${summary.content}`);
            }
          }

          // Governance prompt
          parts.push(buildGovernancePrompt(discussion, agentId, agent.name));

          const systemPrompt = parts.join('\n\n---\n\n');
          const provider = resolveProvider(agent);

          const session = await deps.terminal.createSession(trackId, {
            systemPrompt,
            provider,
            background: false,
            initialPrompt: `A new discussion "${data.title}" has been opened. Use workshop_discussion_read to review the proposal and share your perspective.`,
          });

          deps.discussionSessions.create({
            discussionId: discussion.id,
            agentId: agentId as AgentId,
            sessionId: session.id,
            createdAt: new Date().toISOString(),
          });

          spawnedCount++;
        } catch (err) {
          console.error(`Discussion ${discussion.id}: failed to spawn session for ${agentId}:`, err);
        }
      }

      // If ALL agents failed to spawn, mark discussion as failed
      if (spawnedCount === 0 && participantIds.length > 0) {
        deps.discussions.updateStatus(discussion.id, 'failed');
        discussion.status = 'failed';
      }

      deps.broadcast('discussion:created', discussion.id);
      return discussion;
    },

    postMessage(discussionId, data) {
      const discussion = deps.discussions.findById(discussionId);
      if (!discussion) throw new Error(`Discussion not found: ${discussionId}`);
      if (discussion.status !== 'open') throw new Error(`Discussion is ${discussion.status}, not open`);

      // Validate participant
      if (data.authorId && !discussion.participantIds.includes(data.authorId)) {
        throw new Error(`Author ${data.authorId} is not a participant in this discussion`);
      }

      const message = deps.messages.create({
        discussionId,
        authorType: data.authorType,
        authorId: data.authorId,
        authorName: data.authorName,
        messageType: data.messageType,
        content: data.content,
      });

      deps.discussions.updateLastActivity(discussionId);
      deps.broadcast('discussion:message', discussionId);
      return message;
    },

    async castVote(discussionId, data) {
      const discussion = deps.discussions.findById(discussionId);
      if (!discussion) throw new Error(`Discussion not found: ${discussionId}`);
      if (discussion.status !== 'open') throw new Error(`Discussion is ${discussion.status}, not open`);

      // Validate participant
      if (!discussion.participantIds.includes(data.voterId)) {
        throw new Error(`Voter ${data.voterId} is not a participant in this discussion`);
      }

      const vote = deps.votes.upsert({
        discussionId,
        voterType: data.voterType,
        voterId: data.voterId,
        voterName: data.voterName,
        vote: data.vote,
        comment: data.comment,
        createdAt: new Date().toISOString(),
      });

      deps.discussions.updateLastActivity(discussionId);
      deps.broadcast('discussion:vote', discussionId);

      // Check consensus
      const allVotes = deps.votes.findByDiscussion(discussionId);
      const consensusMet = checkConsensus(discussion, allVotes);

      if (consensusMet) {
        deps.discussions.updateStatus(discussionId, 'consensus');
        await this.closeDiscussion(discussionId);
        deps.broadcast('discussion:consensus', discussionId);
      }

      return vote;
    },

    async closeDiscussion(discussionId) {
      const discussion = deps.discussions.findById(discussionId);
      if (!discussion) return;

      // Update status if not already in a terminal state
      if (discussion.status === 'open') {
        deps.discussions.updateStatus(discussionId, 'closed');
      }

      // Kill all agent sessions
      const discSessions = deps.discussionSessions.findByDiscussion(discussionId);
      for (const ds of discSessions) {
        try {
          const session = deps.sessions.findById(ds.sessionId);
          if (session) {
            await deps.terminal.destroySession(ds.sessionId);
          }
        } catch (err) {
          console.error(`Failed to destroy session ${ds.sessionId}:`, err);
        }
      }

      deps.discussionSessions.deleteByDiscussion(discussionId);
      deps.broadcast('discussion:closed', discussionId);
    },

    getDiscussionState(discussionId) {
      const discussion = deps.discussions.findById(discussionId);
      if (!discussion) return null;

      const messages = deps.messages.findByDiscussion(discussionId);
      const votes = deps.votes.findByDiscussion(discussionId);
      const consensusMet = checkConsensus(discussion, votes);

      return {
        discussion,
        messages,
        votes,
        consensusMet,
        participantCount: discussion.participantIds.length,
        votedCount: votes.length,
        satisfiedCount: votes.filter((v) => v.vote === 'satisfied').length,
      };
    },
  };
}

/** Pure function to evaluate consensus rules */
export function evaluateConsensus(
  rule: ConsensusRule,
  participantIds: string[],
  votes: DiscussionVote[],
): boolean {
  if (participantIds.length === 0) return false;

  switch (rule.type) {
    case 'unanimous': {
      // Every participant must have voted satisfied
      if (votes.length < participantIds.length) return false;
      return participantIds.every((pid) => {
        const vote = votes.find((v) => v.voterId === pid);
        return vote?.vote === 'satisfied';
      });
    }
    case 'majority': {
      const satisfiedCount = votes.filter((v) => v.vote === 'satisfied').length;
      return satisfiedCount / participantIds.length >= rule.threshold;
    }
    case 'quorum': {
      const totalVoted = votes.length;
      if (totalVoted < rule.minVotes) return false;
      const satisfied = votes.filter((v) => v.vote === 'satisfied').length;
      const unsatisfied = votes.filter((v) => v.vote === 'unsatisfied').length;
      return satisfied > unsatisfied;
    }
    default:
      return false;
  }
}
