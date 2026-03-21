import { getDatabase } from './database.js';
import type { DiscussionSessionRepository } from '@domain/discussion/repository';
import type {
  DiscussionSession,
  DiscussionId,
  DiscussionMessageId,
} from '@foundation/discussion-types';
import type { AgentId, SessionId } from '@foundation/types';

interface SessionRow {
  discussion_id: string;
  agent_id: string;
  session_id: string;
  last_seen_message_id: string | null;
  created_at: string;
}

interface UnreadRow extends SessionRow {
  discussion_title: string;
  unread_count: number;
}

function rowToSession(row: SessionRow): DiscussionSession {
  return {
    discussionId: row.discussion_id as DiscussionId,
    agentId: row.agent_id as AgentId,
    sessionId: row.session_id as SessionId,
    lastSeenMessageId: row.last_seen_message_id
      ? (row.last_seen_message_id as DiscussionMessageId)
      : undefined,
    createdAt: row.created_at,
  };
}

export function createDiscussionSessionRepository(): DiscussionSessionRepository {
  const db = getDatabase();

  const findByDiscussionStmt = db.prepare(
    'SELECT * FROM discussion_sessions WHERE discussion_id = ? ORDER BY created_at ASC',
  );
  const findByAgentStmt = db.prepare(
    'SELECT * FROM discussion_sessions WHERE agent_id = ? ORDER BY created_at ASC',
  );
  const insertStmt = db.prepare(
    `INSERT INTO discussion_sessions (discussion_id, agent_id, session_id, last_seen_message_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const updateLastSeenStmt = db.prepare(
    'UPDATE discussion_sessions SET last_seen_message_id = ? WHERE discussion_id = ? AND agent_id = ?',
  );
  const deleteByDiscussionStmt = db.prepare(
    'DELETE FROM discussion_sessions WHERE discussion_id = ?',
  );
  const deleteOneStmt = db.prepare(
    'DELETE FROM discussion_sessions WHERE discussion_id = ? AND agent_id = ?',
  );

  const findWithUnreadStmt = db.prepare(`
    SELECT ds.*, d.title as discussion_title, unread.cnt as unread_count
    FROM discussion_sessions ds
    JOIN discussions d ON d.id = ds.discussion_id
    JOIN (
      SELECT dm.discussion_id, ds2.agent_id, COUNT(*) as cnt
      FROM discussion_messages dm
      JOIN discussion_sessions ds2 ON ds2.discussion_id = dm.discussion_id
      WHERE (dm.author_id IS NULL OR dm.author_id != ds2.agent_id)
        AND (ds2.last_seen_message_id IS NULL
             OR dm.rowid > (SELECT rowid FROM discussion_messages WHERE id = ds2.last_seen_message_id))
      GROUP BY dm.discussion_id, ds2.agent_id
    ) unread ON unread.discussion_id = ds.discussion_id AND unread.agent_id = ds.agent_id
    WHERE d.status = 'open'
  `);

  return {
    findByDiscussion(discussionId): DiscussionSession[] {
      return (findByDiscussionStmt.all(discussionId) as SessionRow[]).map(rowToSession);
    },

    findByAgent(agentId): DiscussionSession[] {
      return (findByAgentStmt.all(agentId) as SessionRow[]).map(rowToSession);
    },

    create(data): DiscussionSession {
      insertStmt.run(
        data.discussionId,
        data.agentId,
        data.sessionId,
        data.lastSeenMessageId || null,
        data.createdAt,
      );
      return data;
    },

    updateLastSeen(discussionId, agentId, messageId): void {
      updateLastSeenStmt.run(messageId, discussionId, agentId);
    },

    deleteByDiscussion(discussionId): void {
      deleteByDiscussionStmt.run(discussionId);
    },

    deleteOne(discussionId, agentId): void {
      deleteOneStmt.run(discussionId, agentId);
    },

    findWithUnread(): Array<DiscussionSession & { unreadCount: number; discussionTitle: string }> {
      const rows = findWithUnreadStmt.all() as UnreadRow[];
      return rows.map((row) => ({
        ...rowToSession(row),
        unreadCount: row.unread_count,
        discussionTitle: row.discussion_title,
      }));
    },
  };
}
