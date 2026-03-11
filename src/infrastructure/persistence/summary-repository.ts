import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { SummaryRepository } from '@domain/summary/repository';
import type { TrackSummary, SummaryId, TrackId } from '@foundation/types';

export function createSummaryRepository(): SummaryRepository {
  const db = getDatabase();

  return {
    findLatest(trackId: TrackId): TrackSummary | null {
      const row = db
        .prepare('SELECT * FROM summaries WHERE track_id = ? ORDER BY version DESC LIMIT 1')
        .get(trackId) as SummaryRow | undefined;
      return row ? rowToSummary(row) : null;
    },

    findById(id: SummaryId): TrackSummary | null {
      const row = db.prepare('SELECT * FROM summaries WHERE id = ?').get(id) as SummaryRow | undefined;
      return row ? rowToSummary(row) : null;
    },

    findAllByTrack(trackId: TrackId): TrackSummary[] {
      const rows = db
        .prepare('SELECT * FROM summaries WHERE track_id = ? ORDER BY version DESC')
        .all(trackId) as SummaryRow[];
      return rows.map(rowToSummary);
    },

    create(trackId: TrackId, content: string): TrackSummary {
      const id = uuid() as SummaryId;
      const now = new Date().toISOString();

      // Get next version number
      const latest = this.findLatest(trackId);
      const version = latest ? latest.version + 1 : 1;

      db.prepare(
        'INSERT INTO summaries (id, track_id, content, version, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(id, trackId, content, version, now);

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
