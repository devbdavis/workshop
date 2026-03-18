import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { DiscussionRepository } from '@domain/discussion/repository';
import type {
  Discussion,
  DiscussionId,
  DiscussionStatus,
  DiscussionTeamId,
  DiscussionType,
} from '@foundation/discussion-types';
import type { TrackId } from '@foundation/types';

interface DiscussionRow {
  id: string;
  team_id: string;
  title: string;
  type: string;
  status: string;
  artifact: string | null;
  track_id: string | null;
  created_by_type: string;
  created_by_id: string | null;
  participant_ids: string;
  stale_after_minutes: number;
  last_activity_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDiscussion(row: DiscussionRow): Discussion {
  return {
    id: row.id as DiscussionId,
    teamId: row.team_id as DiscussionTeamId,
    title: row.title,
    type: row.type as DiscussionType,
    status: row.status as DiscussionStatus,
    artifact: row.artifact || undefined,
    trackId: row.track_id ? (row.track_id as TrackId) : undefined,
    createdByType: row.created_by_type as 'agent' | 'human',
    createdById: row.created_by_id || undefined,
    participantIds: JSON.parse(row.participant_ids),
    staleAfterMinutes: row.stale_after_minutes,
    lastActivityAt: row.last_activity_at,
    closedAt: row.closed_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createDiscussionRepository(): DiscussionRepository {
  const db = getDatabase();

  const findAllStmt = db.prepare('SELECT * FROM discussions ORDER BY created_at DESC');
  const findByIdStmt = db.prepare('SELECT * FROM discussions WHERE id = ?');
  const insertStmt = db.prepare(
    `INSERT INTO discussions (id, team_id, title, type, status, artifact, track_id, created_by_type, created_by_id, participant_ids, stale_after_minutes, last_activity_at, closed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateStatusStmt = db.prepare(
    'UPDATE discussions SET status = ?, updated_at = ?, closed_at = CASE WHEN ? IN (\'consensus\', \'closed\', \'stale\', \'failed\') THEN ? ELSE closed_at END WHERE id = ?',
  );
  const updateLastActivityStmt = db.prepare(
    'UPDATE discussions SET last_activity_at = ?, updated_at = ? WHERE id = ?',
  );
  const deleteStmt = db.prepare('DELETE FROM discussions WHERE id = ?');

  return {
    findAll(filters?): Discussion[] {
      let sql = 'SELECT * FROM discussions';
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (filters?.status) {
        conditions.push('status = ?');
        params.push(filters.status);
      }
      if (filters?.teamId) {
        conditions.push('team_id = ?');
        params.push(filters.teamId);
      }
      if (filters?.trackId) {
        conditions.push('track_id = ?');
        params.push(filters.trackId);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }
      sql += ' ORDER BY created_at DESC';

      return (db.prepare(sql).all(...params) as DiscussionRow[]).map(rowToDiscussion);
    },

    findById(id): Discussion | null {
      const row = findByIdStmt.get(id) as DiscussionRow | undefined;
      return row ? rowToDiscussion(row) : null;
    },

    create(data): Discussion {
      const id = uuid() as DiscussionId;
      const now = new Date().toISOString();
      insertStmt.run(
        id,
        data.teamId,
        data.title,
        data.type,
        data.status,
        data.artifact || null,
        data.trackId || null,
        data.createdByType,
        data.createdById || null,
        JSON.stringify(data.participantIds),
        data.staleAfterMinutes,
        data.lastActivityAt,
        data.closedAt || null,
        now,
        now,
      );
      return { ...data, id, createdAt: now, updatedAt: now };
    },

    updateStatus(id, status): Discussion | null {
      const now = new Date().toISOString();
      updateStatusStmt.run(status, now, status, now, id);
      return this.findById(id);
    },

    updateLastActivity(id): Discussion | null {
      const now = new Date().toISOString();
      updateLastActivityStmt.run(now, now, id);
      return this.findById(id);
    },

    update(id, data): Discussion | null {
      const existing = this.findById(id);
      if (!existing) return null;
      const now = new Date().toISOString();
      const title = data.title ?? existing.title;
      const artifact = data.artifact !== undefined ? data.artifact : existing.artifact;
      const trackId = data.trackId !== undefined ? data.trackId : existing.trackId;
      db.prepare(
        'UPDATE discussions SET title = ?, artifact = ?, track_id = ?, updated_at = ? WHERE id = ?',
      ).run(title, artifact || null, trackId || null, now, id);
      return { ...existing, title, artifact, trackId, updatedAt: now };
    },

    delete(id): boolean {
      return deleteStmt.run(id).changes > 0;
    },
  };
}
