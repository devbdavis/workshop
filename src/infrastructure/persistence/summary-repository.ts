import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { SummaryRepository } from '@domain/summary/repository';
import type { TrackSummary, SummaryId, TrackId } from '@foundation/types';

export function createSummaryRepository(): SummaryRepository {
  const db = getDatabase();

  // Prepare statements once
  const findLatestStmt = db.prepare('SELECT * FROM summaries WHERE track_id = ? ORDER BY version DESC LIMIT 1');
  const findByIdStmt = db.prepare('SELECT * FROM summaries WHERE id = ?');
  const findAllByTrackStmt = db.prepare('SELECT * FROM summaries WHERE track_id = ? ORDER BY version DESC');
  const insertStmt = db.prepare(
    'INSERT INTO summaries (id, track_id, content, version, created_at) VALUES (?, ?, ?, ?, ?)',
  );

  return {
    findLatest(trackId: TrackId): TrackSummary | null {
      const row = findLatestStmt.get(trackId) as SummaryRow | undefined;
      return row ? rowToSummary(row) : null;
    },

    findById(id: SummaryId): TrackSummary | null {
      const row = findByIdStmt.get(id) as SummaryRow | undefined;
      return row ? rowToSummary(row) : null;
    },

    findAllByTrack(trackId: TrackId): TrackSummary[] {
      const rows = findAllByTrackStmt.all(trackId) as SummaryRow[];
      return rows.map(rowToSummary);
    },

    create(trackId: TrackId, content: string): TrackSummary {
      const id = uuid() as SummaryId;
      const now = new Date().toISOString();

      // Get next version number
      const latest = this.findLatest(trackId);
      const version = latest ? latest.version + 1 : 1;

      insertStmt.run(id, trackId, content, version, now);

      return { id, trackId, content, version, createdAt: now };
    },
  };
}

interface SummaryRow {
  id: string;
  track_id: string;
  content: string;
  version: number;
  created_at: string;
}

function rowToSummary(row: SummaryRow): TrackSummary {
  return {
    id: row.id as SummaryId,
    trackId: row.track_id as TrackId,
    content: row.content,
    version: row.version,
    createdAt: row.created_at,
  };
}
