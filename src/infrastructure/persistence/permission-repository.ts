import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { PermissionRequestRepository } from '@domain/permission/repository';
import type {
  PermissionRequest,
  PermissionRequestId,
  PermissionDecision,
  SessionId,
} from '@foundation/types';

export function createPermissionRequestRepository(): PermissionRequestRepository {
  const db = getDatabase();

  return {
    findById(id: PermissionRequestId): PermissionRequest | null {
      const row = db.prepare('SELECT * FROM permission_requests WHERE id = ?').get(id) as Row | undefined;
      return row ? rowToPermission(row) : null;
    },

    findBySession(sessionId: SessionId): PermissionRequest[] {
      const rows = db
        .prepare('SELECT * FROM permission_requests WHERE session_id = ? ORDER BY created_at DESC')
        .all(sessionId) as Row[];
      return rows.map(rowToPermission);
    },

    findPendingBySession(sessionId: SessionId): PermissionRequest[] {
      const rows = db
        .prepare("SELECT * FROM permission_requests WHERE session_id = ? AND decision = 'pending' ORDER BY created_at ASC")
        .all(sessionId) as Row[];
      return rows.map(rowToPermission);
    },

    create(data): PermissionRequest {
      const id = uuid() as PermissionRequestId;
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO permission_requests (id, session_id, tool_name, tool_input, decision, decision_reason, user_comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        data.sessionId,
        data.toolName,
        JSON.stringify(data.toolInput),
        data.decision,
        data.decisionReason || null,
        data.userComment || null,
        now,
      );

      return {
        id,
        sessionId: data.sessionId,
        toolName: data.toolName,
        toolInput: data.toolInput,
        decision: data.decision,
        decisionReason: data.decisionReason,
        userComment: data.userComment,
        createdAt: now,
      };
    },

    resolve(id, decision, reason?, comment?): PermissionRequest | null {
      const existing = this.findById(id);
      if (!existing) return null;

      const now = new Date().toISOString();
      db.prepare(
        'UPDATE permission_requests SET decision = ?, decision_reason = ?, user_comment = ?, resolved_at = ? WHERE id = ?',
      ).run(decision, reason || null, comment || null, now, id);

      return {
        ...existing,
        decision,
        decisionReason: reason,
        userComment: comment,
        resolvedAt: now,
      };
    },

    delete(id: PermissionRequestId): boolean {
      const result = db.prepare('DELETE FROM permission_requests WHERE id = ?').run(id);
      return result.changes > 0;
    },
  };
}

// --- Row type and mapper ---

interface Row {
  id: string;
  session_id: string;
  tool_name: string;
  tool_input: string;
  decision: string;
  decision_reason: string | null;
  user_comment: string | null;
  created_at: string;
  resolved_at: string | null;
}

function rowToPermission(row: Row): PermissionRequest {
  return {
    id: row.id as PermissionRequestId,
    sessionId: row.session_id as SessionId,
    toolName: row.tool_name,
    toolInput: JSON.parse(row.tool_input),
    decision: row.decision as PermissionDecision,
    decisionReason: row.decision_reason || undefined,
    userComment: row.user_comment || undefined,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || undefined,
  };
}
