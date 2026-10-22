import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { IssueDependency, WorkflowIssueId } from '@foundation/types';
import type { IssueDependencyRepository } from '@domain/workflow/issue-repository.js';

export function createIssueDependencyRepository(): IssueDependencyRepository {
  const db = getDatabase();

  // Prepare statements once
  const findByIssueStmt = db.prepare('SELECT * FROM ticket_dependencies WHERE ticket_id = ? ORDER BY created_at ASC');
  const findDependentsStmt = db.prepare('SELECT * FROM ticket_dependencies WHERE depends_on_id = ? ORDER BY created_at ASC');
  const findUnresolvedStmt = db.prepare('SELECT * FROM ticket_dependencies WHERE ticket_id = ? AND resolved_at IS NULL ORDER BY created_at ASC');
  const insertStmt = db.prepare('INSERT INTO ticket_dependencies (id, ticket_id, depends_on_id, created_at) VALUES (?, ?, ?, ?)');
  const resolveStmt = db.prepare('UPDATE ticket_dependencies SET resolved_at = ? WHERE ticket_id = ? AND depends_on_id = ?');
  const deleteStmt = db.prepare('DELETE FROM ticket_dependencies WHERE ticket_id = ? AND depends_on_id = ?');

  return {
    findByIssue(issueId: WorkflowIssueId): IssueDependency[] {
      const rows = findByIssueStmt.all(issueId) as DepRow[];
      return rows.map(rowToDep);
    },

    findDependents(dependsOnId: WorkflowIssueId): IssueDependency[] {
      const rows = findDependentsStmt.all(dependsOnId) as DepRow[];
      return rows.map(rowToDep);
    },

    findUnresolved(issueId: WorkflowIssueId): IssueDependency[] {
      const rows = findUnresolvedStmt.all(issueId) as DepRow[];
      return rows.map(rowToDep);
    },

    create(issueId: WorkflowIssueId, dependsOnId: WorkflowIssueId): IssueDependency {
      const id = uuid();
      const now = new Date().toISOString();
      insertStmt.run(id, issueId, dependsOnId, now);
      return { id, issueId, dependsOnId, createdAt: now };
    },

    resolve(issueId: WorkflowIssueId, dependsOnId: WorkflowIssueId): boolean {
      const now = new Date().toISOString();
      const result = resolveStmt.run(now, issueId, dependsOnId);
      return result.changes > 0;
    },

    delete(issueId: WorkflowIssueId, dependsOnId: WorkflowIssueId): boolean {
      const result = deleteStmt.run(issueId, dependsOnId);
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

function rowToDep(row: DepRow): IssueDependency {
  return {
    id: row.id,
    issueId: row.ticket_id as WorkflowIssueId,
    dependsOnId: row.depends_on_id as WorkflowIssueId,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || undefined,
  };
}
