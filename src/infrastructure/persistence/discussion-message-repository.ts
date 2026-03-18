import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { DiscussionMessageRepository } from '@domain/discussion/repository';
import type {
  DiscussionMessage,
  DiscussionMessageId,
  DiscussionMessageType,
  DiscussionId,
} from '@foundation/discussion-types';

interface MessageRow {
  id: string;
  discussion_id: string;
  author_type: string;
  author_id: string | null;
  author_name: string | null;
  message_type: string;
  content: string;
  created_at: string;
}

function rowToMessage(row: MessageRow): DiscussionMessage {
  return {
    id: row.id as DiscussionMessageId,
    discussionId: row.discussion_id as DiscussionId,
    authorType: row.author_type as 'agent' | 'human',
    authorId: row.author_id || undefined,
    authorName: row.author_name || undefined,
    messageType: row.message_type as DiscussionMessageType,
    content: row.content,
    createdAt: row.created_at,
  };
}

export function createDiscussionMessageRepository(): DiscussionMessageRepository {
  const db = getDatabase();

  const findByDiscussionStmt = db.prepare(
    'SELECT * FROM discussion_messages WHERE discussion_id = ? ORDER BY created_at ASC',
  );
  const findByIdStmt = db.prepare('SELECT * FROM discussion_messages WHERE id = ?');
  const insertStmt = db.prepare(
    `INSERT INTO discussion_messages (id, discussion_id, author_type, author_id, author_name, message_type, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const countStmt = db.prepare(
    'SELECT COUNT(*) as cnt FROM discussion_messages WHERE discussion_id = ?',
  );
  const latestRowidStmt = db.prepare(
    'SELECT MAX(rowid) as max_rowid FROM discussion_messages WHERE discussion_id = ?',
  );
  const findAfterStmt = db.prepare(
    'SELECT * FROM discussion_messages WHERE discussion_id = ? AND rowid > ? ORDER BY rowid ASC',
  );

  return {
    findByDiscussion(discussionId): DiscussionMessage[] {
      return (findByDiscussionStmt.all(discussionId) as MessageRow[]).map(rowToMessage);
    },

    findById(id): DiscussionMessage | null {
      const row = findByIdStmt.get(id) as MessageRow | undefined;
      return row ? rowToMessage(row) : null;
    },

    findAfter(discussionId, afterRowid): DiscussionMessage[] {
      return (findAfterStmt.all(discussionId, afterRowid) as MessageRow[]).map(rowToMessage);
    },

    create(data): DiscussionMessage {
      const id = uuid() as DiscussionMessageId;
      const now = new Date().toISOString();
      insertStmt.run(
        id,
        data.discussionId,
        data.authorType,
        data.authorId || null,
        data.authorName || null,
        data.messageType,
        data.content,
        now,
      );
      return { ...data, id, createdAt: now };
    },

    countByDiscussion(discussionId): number {
      const result = countStmt.get(discussionId) as { cnt: number };
      return result.cnt;
    },

    latestRowid(discussionId): number | null {
      const result = latestRowidStmt.get(discussionId) as { max_rowid: number | null };
      return result.max_rowid;
    },
  };
}
