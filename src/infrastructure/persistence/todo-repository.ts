import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { TodoRepository, TodoUpdateData } from '@domain/todo/repository';
import type { Todo, TodoId, TodoStatus, TrackId, SessionId, AgentId } from '@foundation/types';

export function createTodoRepository(): TodoRepository {
  const db = getDatabase();

  // Prepare statements once
  const findByIdStmt = db.prepare('SELECT * FROM todos WHERE id = ?');
  const findByTrackStmt = db.prepare('SELECT * FROM todos WHERE track_id = ? ORDER BY sort_order ASC, created_at DESC');
  const findAllStmt = db.prepare('SELECT * FROM todos ORDER BY sort_order ASC, created_at DESC');
  const findByStatusStmt = db.prepare('SELECT * FROM todos WHERE status = ? ORDER BY sort_order ASC, created_at DESC');
  const findBySessionStmt = db.prepare('SELECT * FROM todos WHERE session_id = ?');
  const insertStmt = db.prepare(
    `INSERT INTO todos (id, track_id, title, description, resolution, issue_key, status, priority, refined, session_id, agent_id, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateStmt = db.prepare(
    `UPDATE todos
     SET title = ?, description = ?, resolution = ?, issue_key = ?, status = ?, priority = ?, refined = ?, session_id = ?, agent_id = ?, sort_order = ?, updated_at = ?
     WHERE id = ?`,
  );
  const deleteStmt = db.prepare('DELETE FROM todos WHERE id = ?');

  return {
    findById(id: TodoId): Todo | null {
      const row = findByIdStmt.get(id) as TodoRow | undefined;
      return row ? rowToTodo(row) : null;
    },

    findByTrack(trackId: TrackId): Todo[] {
      const rows = findByTrackStmt.all(trackId) as TodoRow[];
      return rows.map(rowToTodo);
    },

    findAll(): Todo[] {
      const rows = findAllStmt.all() as TodoRow[];
      return rows.map(rowToTodo);
    },

    findByStatus(status: TodoStatus): Todo[] {
      const rows = findByStatusStmt.all(status) as TodoRow[];
      return rows.map(rowToTodo);
    },

    findBySession(sessionId: SessionId): Todo | null {
      const row = findBySessionStmt.get(sessionId) as TodoRow | undefined;
      return row ? rowToTodo(row) : null;
    },

    create(data): Todo {
      const id = uuid() as TodoId;
      const now = new Date().toISOString();

      insertStmt.run(
        id,
        data.trackId,
        data.title,
        data.description || null,
        data.resolution || null,
        data.issueKey || null,
        data.status,
        data.priority,
        data.refined ? 1 : 0,
        data.sessionId || null,
        data.agentId || null,
        data.sortOrder,
        now,
        now,
      );

      return {
        id,
        trackId: data.trackId,
        title: data.title,
        description: data.description,
        resolution: data.resolution,
        issueKey: data.issueKey,
        status: data.status,
        priority: data.priority,
        refined: data.refined,
        sessionId: data.sessionId,
        agentId: data.agentId,
        sortOrder: data.sortOrder,
        createdAt: now,
        updatedAt: now,
      };
    },

    update(id, data: TodoUpdateData): Todo | null {
      const existing = this.findById(id);
      if (!existing) return null;

      const now = new Date().toISOString();
      const title = data.title ?? existing.title;
      const description = data.description !== undefined ? data.description : existing.description;
      const resolution = data.resolution !== undefined ? data.resolution : existing.resolution;
      const issueKey = data.issueKey !== undefined ? data.issueKey : existing.issueKey;
      const status = data.status ?? existing.status;
      const priority = data.priority ?? existing.priority;
      const refined = data.refined !== undefined ? data.refined : existing.refined;
      // null = explicit clear; undefined = preserve existing
      const sessionId = data.sessionId !== undefined ? (data.sessionId ?? undefined) : existing.sessionId;
      const agentId = data.agentId !== undefined ? (data.agentId ?? undefined) : existing.agentId;
      const sortOrder = data.sortOrder ?? existing.sortOrder;

      updateStmt.run(
        title,
        description || null,
        resolution || null,
        issueKey || null,
        status,
        priority,
        refined ? 1 : 0,
        sessionId || null,
        agentId || null,
        sortOrder,
        now,
        id,
      );

      return {
        ...existing,
        title,
        description,
        resolution,
        issueKey,
        status,
        priority,
        refined,
        sessionId,
        agentId,
        sortOrder,
        updatedAt: now,
      };
    },

    delete(id: TodoId): boolean {
      const result = deleteStmt.run(id);
      return result.changes > 0;
    },
  };
}

// --- Row type and mapper ---

interface TodoRow {
  id: string;
  track_id: string;
  title: string;
  description: string | null;
  resolution: string | null;
  issue_key: string | null;
  status: string;
  priority: string;
  refined: number;
  session_id: string | null;
  agent_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function rowToTodo(row: TodoRow): Todo {
  return {
    id: row.id as TodoId,
    trackId: row.track_id as TrackId,
    title: row.title,
    description: row.description || undefined,
    resolution: row.resolution || undefined,
    issueKey: row.issue_key || undefined,
    status: row.status as TodoStatus,
    priority: row.priority as Todo['priority'],
    refined: row.refined === 1,
    sessionId: row.session_id as SessionId | undefined || undefined,
    agentId: row.agent_id as AgentId | undefined || undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
