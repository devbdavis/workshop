import type { AgentId, SessionId, TrackId } from './types.js';

// Branded IDs
export type DiscussionTeamId = string & { readonly __brand: 'DiscussionTeamId' };
export type DiscussionId = string & { readonly __brand: 'DiscussionId' };
export type DiscussionMessageId = string & { readonly __brand: 'DiscussionMessageId' };

// Consensus rules
export type ConsensusRule =
  | { type: 'unanimous' }
  | { type: 'majority'; threshold: number }
  | { type: 'quorum'; minVotes: number };

// Discussion Team
export interface DiscussionTeam {
  id: DiscussionTeamId;
  name: string;
  description?: string;
  consensusRule: ConsensusRule;
  memberAgentIds: AgentId[];
  createdAt: string;
  updatedAt: string;
}

// Discussion
export type DiscussionType = 'rfc' | 'question' | 'review';
export type DiscussionStatus = 'open' | 'consensus' | 'closed' | 'stale' | 'failed';

export interface Discussion {
  id: DiscussionId;
  teamId: DiscussionTeamId;
  title: string;
  type: DiscussionType;
  status: DiscussionStatus;
  artifact?: string;
  trackId?: TrackId;
  createdByType: 'agent' | 'human';
  createdById?: string;
  participantIds: string[];
  staleAfterMinutes: number;
  /** Session spawned by "Act on Consensus" to implement the outcome */
  actSessionId?: SessionId;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

// Discussion Message
export type DiscussionMessageType =
  | 'proposal'
  | 'comment'
  | 'suggestion'
  | 'objection'
  | 'revision'
  | 'satisfied'
  | 'unsatisfied';

export interface DiscussionMessage {
  id: DiscussionMessageId;
  discussionId: DiscussionId;
  authorType: 'agent' | 'human';
  authorId?: string;
  authorName?: string;
  messageType: DiscussionMessageType;
  content: string;
  createdAt: string;
}

// Discussion Vote
export type DiscussionVoteValue = 'satisfied' | 'unsatisfied' | 'abstain';

export interface DiscussionVote {
  discussionId: DiscussionId;
  voterType: 'agent' | 'human';
  voterId: string;
  voterName?: string;
  vote: DiscussionVoteValue;
  comment?: string;
  createdAt: string;
}

// Discussion Session (join table: agent x discussion -> tmux session)
export interface DiscussionSession {
  discussionId: DiscussionId;
  agentId: AgentId;
  sessionId: SessionId;
  lastSeenMessageId?: DiscussionMessageId;
  createdAt: string;
}
