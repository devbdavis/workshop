import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { TicketRepository } from '@domain/ticket/repository';
import type {
  ExternalTicket,
  TicketId,
  TrackId,
  TicketSource,
  TicketRelationship,
} from '@foundation/types';

export function createTicketRepository(): TicketRepository {
  const db = getDatabase();

  return {
    findById(id: TicketId): ExternalTicket | null {
      const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as TicketRow | undefined;
      return row ? rowToTicket(row) : null;
    },

    findByTrack(trackId: TrackId): ExternalTicket[] {
      const rows = db
        .prepare('SELECT * FROM tickets WHERE track_id = ? ORDER BY created_at DESC')
        .all(trackId) as TicketRow[];
      return rows.map(rowToTicket);
    },

    findByExternalId(source: TicketSource, externalId: string): ExternalTicket[] {
      const rows = db
        .prepare('SELECT * FROM tickets WHERE source = ? AND external_id = ?')
        .all(source, externalId) as TicketRow[];
      return rows.map(rowToTicket);
    },

    create(data): ExternalTicket {
      const id = uuid() as TicketId;
      const now = new Date().toISOString();
      db.prepare(
        'INSERT INTO tickets (id, track_id, source, external_id, relationship, cached_title, cached_status, cached_data, last_synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
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

    updateCachedData(id, data): ExternalTicket | null {
      const now = new Date().toISOString();
      const existing = this.findById(id);
      if (!existing) return null;

      db.prepare(
        'UPDATE tickets SET cached_title = ?, cached_status = ?, cached_data = ?, last_synced_at = ? WHERE id = ?',
      ).run(
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

    updateRelationship(id, relationship): ExternalTicket | null {
      const result = db.prepare('UPDATE tickets SET relationship = ? WHERE id = ?').run(relationship, id);
      if (result.changes === 0) return null;
      return this.findById(id);
    },

    delete(id: TicketId): boolean {
      const result = db.prepare('DELETE FROM tickets WHERE id = ?').run(id);
      return result.changes > 0;
    },
  };
}

interface TicketRow {
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

function rowToTicket(row: TicketRow): ExternalTicket {
  return {
    id: row.id as TicketId,
    trackId: row.track_id as TrackId,
    source: row.source as TicketSource,
    externalId: row.external_id,
    relationship: row.relationship as TicketRelationship,
    cachedTitle: row.cached_title || undefined,
    cachedStatus: row.cached_status || undefined,
    cachedData: row.cached_data || undefined,
    lastSyncedAt: row.last_synced_at || undefined,
    createdAt: row.created_at,
  };
}
