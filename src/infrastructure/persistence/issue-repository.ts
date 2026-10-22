import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { IssueRepository } from '@domain/issue/repository';
import type {
  ExternalIssue,
  IssueId,
  TrackId,
  IssueSource,
  IssueRelationship,
} from '@foundation/types';

export function createIssueRepository(): IssueRepository {
  const db = getDatabase();

  // Prepare statements once
  const findByIdStmt = db.prepare('SELECT * FROM tickets WHERE id = ?');
  const findByTrackStmt = db.prepare('SELECT * FROM tickets WHERE track_id = ? ORDER BY created_at DESC');
  const findByExternalIdStmt = db.prepare('SELECT * FROM tickets WHERE source = ? AND external_id = ?');
  const insertStmt = db.prepare(
    'INSERT INTO tickets (id, track_id, source, external_id, relationship, cached_title, cached_status, cached_data, last_synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const updateCachedDataStmt = db.prepare(
    'UPDATE tickets SET cached_title = ?, cached_status = ?, cached_data = ?, last_synced_at = ? WHERE id = ?',
  );
  const updateRelationshipStmt = db.prepare('UPDATE tickets SET relationship = ? WHERE id = ?');
  const deleteStmt = db.prepare('DELETE FROM tickets WHERE id = ?');

  return {
    findById(id: IssueId): ExternalIssue | null {
      const row = findByIdStmt.get(id) as IssueRow | undefined;
      return row ? rowToIssue(row) : null;
    },

    findByTrack(trackId: TrackId): ExternalIssue[] {
      const rows = findByTrackStmt.all(trackId) as IssueRow[];
      return rows.map(rowToIssue);
    },

    findByExternalId(source: IssueSource, externalId: string): ExternalIssue[] {
      const rows = findByExternalIdStmt.all(source, externalId) as IssueRow[];
      return rows.map(rowToIssue);
    },

    create(data): ExternalIssue {
      const id = uuid() as IssueId;
      const now = new Date().toISOString();
      insertStmt.run(
        id,
        data.trackId,
        data.source,
        data.externalId,
        data.relationship,
        data.cachedTitle || null,
        data.cachedStatus || null,
        data.cachedData || null,
        data.lastSyncedAt || null,
        now,
      );
      return { ...data, id, createdAt: now };
    },

    updateCachedData(id, data): ExternalIssue | null {
      const now = new Date().toISOString();
      const existing = this.findById(id);
      if (!existing) return null;

      updateCachedDataStmt.run(
        data.cachedTitle ?? existing.cachedTitle ?? null,
        data.cachedStatus ?? existing.cachedStatus ?? null,
        data.cachedData ?? existing.cachedData ?? null,
        now,
        id,
      );

      return {
        ...existing,
        cachedTitle: data.cachedTitle ?? existing.cachedTitle,
        cachedStatus: data.cachedStatus ?? existing.cachedStatus,
        cachedData: data.cachedData ?? existing.cachedData,
        lastSyncedAt: now,
      };
    },

    updateRelationship(id, relationship): ExternalIssue | null {
      const result = updateRelationshipStmt.run(relationship, id);
      if (result.changes === 0) return null;
      return this.findById(id);
    },

    delete(id: IssueId): boolean {
      const result = deleteStmt.run(id);
      return result.changes > 0;
    },
  };
}

interface IssueRow {
  id: string;
  track_id: string;
  source: string;
  external_id: string;
  relationship: string;
  cached_title: string | null;
  cached_status: string | null;
  cached_data: string | null;
  last_synced_at: string | null;
  created_at: string;
}

function rowToIssue(row: IssueRow): ExternalIssue {
  return {
    id: row.id as IssueId,
    trackId: row.track_id as TrackId,
    source: row.source as IssueSource,
    externalId: row.external_id,
    relationship: row.relationship as IssueRelationship,
    cachedTitle: row.cached_title || undefined,
    cachedStatus: row.cached_status || undefined,
    cachedData: row.cached_data || undefined,
    lastSyncedAt: row.last_synced_at || undefined,
    createdAt: row.created_at,
  };
}
