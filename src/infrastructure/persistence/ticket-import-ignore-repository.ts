import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { TicketImportIgnoreRepository } from '@domain/ticket-import/repository';
import type { TicketImportIgnore, TicketImportIgnoreId, TicketSource } from '@foundation/types';

interface IgnoreRow {
  id: string;
  source: string;
  external_id: string;
  cached_title: string | null;
  cached_url: string | null;
  created_at: string;
}

function rowToIgnore(row: IgnoreRow): TicketImportIgnore {
  return {
    id: row.id as TicketImportIgnoreId,
    source: row.source as TicketSource,
    externalId: row.external_id,
    cachedTitle: row.cached_title || undefined,
    cachedUrl: row.cached_url || undefined,
    createdAt: row.created_at,
  };
}

export function createTicketImportIgnoreRepository(): TicketImportIgnoreRepository {
  const db = getDatabase();

  const findBySourceStmt = db.prepare(
    'SELECT * FROM ticket_import_ignores WHERE source = ? ORDER BY created_at DESC',
  );
  const findOneStmt = db.prepare(
    'SELECT * FROM ticket_import_ignores WHERE source = ? AND external_id = ?',
  );
  // Using INSERT OR REPLACE so repeated ignore clicks refresh the cached title/url
  // rather than erroring out on the UNIQUE constraint.
  const upsertStmt = db.prepare(
    `INSERT INTO ticket_import_ignores (id, source, external_id, cached_title, cached_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, external_id) DO UPDATE SET
       cached_title = excluded.cached_title,
       cached_url = excluded.cached_url`,
  );
  const deleteStmt = db.prepare(
    'DELETE FROM ticket_import_ignores WHERE source = ? AND external_id = ?',
  );

  return {
    findBySource(source: TicketSource): TicketImportIgnore[] {
      const rows = findBySourceStmt.all(source) as IgnoreRow[];
      return rows.map(rowToIgnore);
    },

    findOne(source: TicketSource, externalId: string): TicketImportIgnore | null {
      const row = findOneStmt.get(source, externalId) as IgnoreRow | undefined;
      return row ? rowToIgnore(row) : null;
    },

    add(data): TicketImportIgnore {
      const existing = findOneStmt.get(data.source, data.externalId) as IgnoreRow | undefined;
      const id = (existing?.id ?? uuid()) as TicketImportIgnoreId;
      const createdAt = existing?.created_at ?? new Date().toISOString();
      upsertStmt.run(
        id,
        data.source,
        data.externalId,
        data.cachedTitle || null,
        data.cachedUrl || null,
        createdAt,
      );
      return {
        id,
        source: data.source,
        externalId: data.externalId,
        cachedTitle: data.cachedTitle,
        cachedUrl: data.cachedUrl,
        createdAt,
      };
    },

    remove(source: TicketSource, externalId: string): boolean {
      const result = deleteStmt.run(source, externalId);
      return result.changes > 0;
    },
  };
}
