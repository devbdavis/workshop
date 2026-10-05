import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { DiffCommentRepository, DiffCommentInput, DiffCommentPatch } from '@domain/diff-comment/repository';
import type { DiffComment, DiffCommentId, DiffCommentStatus, SessionId } from '@foundation/types';

interface DiffCommentRow {
  id: string;
  session_id: string;
  file: string;
  line: number;
  side: string;
  line_text: string;
  body: string;
  code_context: string | null;
  anchored: number;
  status: string;
  sent_at: string | null;
  created_at: string;
}

const VALID_STATUSES: ReadonlySet<DiffCommentStatus> = new Set(['open', 'resolved']);

function rowToComment(row: DiffCommentRow): DiffComment {
  return {
    id: row.id as DiffCommentId,
    sessionId: row.session_id as SessionId,
    file: row.file,
    line: row.line,
    side: 'RIGHT',
    lineText: row.line_text,
    body: row.body,
    codeContext: row.code_context ?? undefined,
    anchored: row.anchored === 1,
    status: VALID_STATUSES.has(row.status as DiffCommentStatus) ? (row.status as DiffCommentStatus) : 'open',
    sentAt: row.sent_at ?? undefined,
    createdAt: row.created_at,
  };
}

export function createDiffCommentRepository(): DiffCommentRepository {
  const db = getDatabase();

  const findBySessionStmt = db.prepare('SELECT * FROM diff_comments WHERE session_id = ? ORDER BY created_at ASC');
  const findByIdStmt = db.prepare('SELECT * FROM diff_comments WHERE id = ?');
  const insertStmt = db.prepare(`
    INSERT INTO diff_comments (
      id, session_id, file, line, side, line_text, body, code_context, anchored, status, created_at
    ) VALUES (?, ?, ?, ?, 'RIGHT', ?, ?, ?, 1, 'open', ?)
  `);
  const deleteStmt = db.prepare('DELETE FROM diff_comments WHERE id = ?');

  return {
    findBySession(sessionId: SessionId): DiffComment[] {
      return (findBySessionStmt.all(sessionId) as DiffCommentRow[]).map(rowToComment);
    },

    findById(id: DiffCommentId): DiffComment | null {
      const row = findByIdStmt.get(id) as DiffCommentRow | undefined;
      return row ? rowToComment(row) : null;
    },

    create(input: DiffCommentInput): DiffComment {
      const id = uuid();
      const now = new Date().toISOString();
      insertStmt.run(id, input.sessionId, input.file, input.line, input.lineText, input.body, input.codeContext ?? null, now);
      return this.findById(id as DiffCommentId)!;
    },

    update(id: DiffCommentId, patch: DiffCommentPatch): DiffComment | null {
      const existing = this.findById(id);
      if (!existing) return null;
      const sets: string[] = [];
      const values: unknown[] = [];
      const columns: Array<[keyof DiffCommentPatch, string]> = [
        ['body', 'body'],
        ['status', 'status'],
        ['line', 'line'],
        ['anchored', 'anchored'],
        ['codeContext', 'code_context'],
        ['sentAt', 'sent_at'],
      ];
      for (const [key, column] of columns) {
        if (patch[key] !== undefined) {
          sets.push(`${column} = ?`);
          values.push(key === 'anchored' ? (patch.anchored ? 1 : 0) : patch[key]);
        }
      }
      if (sets.length > 0) {
        db.prepare(`UPDATE diff_comments SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
      }
      return this.findById(id);
    },

    delete(id: DiffCommentId): boolean {
      return deleteStmt.run(id).changes > 0;
    },
  };
}
