import type {
  DiscussionTeam,
  DiscussionTeamId,
  Discussion,
  DiscussionId,
  DiscussionStatus,
  DiscussionMessage,
  DiscussionMessageId,
  DiscussionVote,
  DiscussionSession,
} from '@foundation/discussion-types';
import type { AgentId, SessionId, TrackId } from '@foundation/types';

export interface DiscussionTeamRepository {
  findAll(): DiscussionTeam[];
  findById(id: DiscussionTeamId): DiscussionTeam | null;
  create(data: Omit<DiscussionTeam, 'id' | 'createdAt' | 'updatedAt'>): DiscussionTeam;
  update(id: DiscussionTeamId, data: Partial<Pick<DiscussionTeam, 'name' | 'description' | 'consensusRule' | 'memberAgentIds'>>): DiscussionTeam | null;
  delete(id: DiscussionTeamId): boolean;
}

export interface DiscussionRepository {
  findAll(filters?: { status?: DiscussionStatus; teamId?: DiscussionTeamId; trackId?: TrackId }): Discussion[];
  findById(id: DiscussionId): Discussion | null;
  create(data: Omit<Discussion, 'id' | 'createdAt' | 'updatedAt'>): Discussion;
  updateStatus(id: DiscussionId, status: DiscussionStatus): Discussion | null;
  updateLastActivity(id: DiscussionId): Discussion | null;
  update(id: DiscussionId, data: Partial<Pick<Discussion, 'title' | 'artifact' | 'trackId'>>): Discussion | null;
  delete(id: DiscussionId): boolean;
}

export interface DiscussionMessageRepository {
  findByDiscussion(discussionId: DiscussionId): DiscussionMessage[];
  findById(id: DiscussionMessageId): DiscussionMessage | null;
  findAfter(discussionId: DiscussionId, afterRowid: number): DiscussionMessage[];
  create(data: Omit<DiscussionMessage, 'id' | 'createdAt'>): DiscussionMessage;
  countByDiscussion(discussionId: DiscussionId): number;
  latestRowid(discussionId: DiscussionId): number | null;
}

export interface DiscussionVoteRepository {
  findByDiscussion(discussionId: DiscussionId): DiscussionVote[];
  upsert(vote: DiscussionVote): DiscussionVote;
  findByVoter(discussionId: DiscussionId, voterType: string, voterId: string): DiscussionVote | null;
}

export interface DiscussionSessionRepository {
  findByDiscussion(discussionId: DiscussionId): DiscussionSession[];
  findByAgent(agentId: AgentId): DiscussionSession[];
  create(data: DiscussionSession): DiscussionSession;
  updateLastSeen(discussionId: DiscussionId, agentId: AgentId, messageId: DiscussionMessageId): void;
  deleteByDiscussion(discussionId: DiscussionId): void;
  findWithUnread(): Array<DiscussionSession & { unreadCount: number; discussionTitle: string }>;
}
