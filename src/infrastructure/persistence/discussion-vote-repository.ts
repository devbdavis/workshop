import { getDatabase } from './database.js';
import type { DiscussionVoteRepository } from '@domain/discussion/repository';
import type { DiscussionVote, DiscussionId, DiscussionVoteValue } from '@foundation/discussion-types';

interface VoteRow {
  discussion_id: string;
  voter_type: string;
  voter_id: string;
  voter_name: string | null;
  vote: string;
  comment: string | null;
  created_at: string;
}

function rowToVote(row: VoteRow): DiscussionVote {
  return {
    discussionId: row.discussion_id as DiscussionId,
    voterType: row.voter_type as 'agent' | 'human',
    voterId: row.voter_id,
    voterName: row.voter_name || undefined,
    vote: row.vote as DiscussionVoteValue,
    comment: row.comment || undefined,
    createdAt: row.created_at,
  };
}

export function createDiscussionVoteRepository(): DiscussionVoteRepository {
  const db = getDatabase();

  const findByDiscussionStmt = db.prepare(
    'SELECT * FROM discussion_votes WHERE discussion_id = ? ORDER BY created_at ASC',
  );
  const findByVoterStmt = db.prepare(
    'SELECT * FROM discussion_votes WHERE discussion_id = ? AND voter_type = ? AND voter_id = ?',
  );
  const upsertStmt = db.prepare(
    `INSERT INTO discussion_votes (discussion_id, voter_type, voter_id, voter_name, vote, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(discussion_id, voter_type, voter_id)
     DO UPDATE SET vote = excluded.vote, voter_name = excluded.voter_name, comment = excluded.comment, created_at = excluded.created_at`,
  );

  return {
    findByDiscussion(discussionId): DiscussionVote[] {
      return (findByDiscussionStmt.all(discussionId) as VoteRow[]).map(rowToVote);
    },

    upsert(vote): DiscussionVote {
      const now = new Date().toISOString();
      upsertStmt.run(
        vote.discussionId,
        vote.voterType,
        vote.voterId,
        vote.voterName || null,
        vote.vote,
        vote.comment || null,
        now,
      );
      return { ...vote, createdAt: now };
    },

    findByVoter(discussionId, voterType, voterId): DiscussionVote | null {
      const row = findByVoterStmt.get(discussionId, voterType, voterId) as VoteRow | undefined;
      return row ? rowToVote(row) : null;
    },
  };
}
