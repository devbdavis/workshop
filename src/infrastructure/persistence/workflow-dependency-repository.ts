import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { TicketDependency, WorkflowTicketId } from '@foundation/types';
import type { TicketDependencyRepository } from '@domain/workflow/repository';

export function createTicketDependencyRepository(): TicketDependencyRepository {
  const db = getDatabase();

  return {
    findByTicket(ticketId: WorkflowTicketId): TicketDependency[] {
      const rows = db.prepare(
        'SELECT * FROM ticket_dependencies WHERE ticket_id = ? ORDER BY created_at ASC',
      ).all(ticketId) as DepRow[];
      return rows.map(rowToDep);
    },

    findDependents(dependsOnId: WorkflowTicketId): TicketDependency[] {
      const rows = db.prepare(
        'SELECT * FROM ticket_dependencies WHERE depends_on_id = ? ORDER BY created_at ASC',
      ).all(dependsOnId) as DepRow[];
      return rows.map(rowToDep);
    },

    findUnresolved(ticketId: WorkflowTicketId): TicketDependency[] {
      const rows = db.prepare(
        'SELECT * FROM ticket_dependencies WHERE ticket_id = ? AND resolved_at IS NULL ORDER BY created_at ASC',
      ).all(ticketId) as DepRow[];
      return rows.map(rowToDep);
    },

    create(ticketId: WorkflowTicketId, dependsOnId: WorkflowTicketId): TicketDependency {
      const id = uuid();
      const now = new Date().toISOString();
      db.prepare(
        'INSERT INTO ticket_dependencies (id, ticket_id, depends_on_id, created_at) VALUES (?, ?, ?, ?)',
      ).run(id, ticketId, dependsOnId, now);
      return { id, ticketId, dependsOnId, createdAt: now };
    },

    resolve(ticketId: WorkflowTicketId, dependsOnId: WorkflowTicketId): boolean {
      const now = new Date().toISOString();
      const result = db.prepare(
        'UPDATE ticket_dependencies SET resolved_at = ? WHERE ticket_id = ? AND depends_on_id = ?',
      ).run(now, ticketId, dependsOnId);
      return result.changes > 0;
    },

    delete(ticketId: WorkflowTicketId, dependsOnId: WorkflowTicketId): boolean {
      const result = db.prepare(
        'DELETE FROM ticket_dependencies WHERE ticket_id = ? AND depends_on_id = ?',
      ).run(ticketId, dependsOnId);
      return result.changes > 0;
    },
  };
}

// --- Row type and mapper ---

interface DepRow {
  id: string;
  ticket_id: string;
  depends_on_id: string;
  created_at: string;
  resolved_at: string | null;
}

function rowToDep(row: DepRow): TicketDependency {
  return {
    id: row.id,
    ticketId: row.ticket_id as WorkflowTicketId,
    dependsOnId: row.depends_on_id as WorkflowTicketId,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || undefined,
  };
}
