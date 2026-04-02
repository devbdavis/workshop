import { getDatabase } from './database.js';

/**
 * Prune old rows from audit/log tables to prevent unbounded DB growth.
 * Keeps the most recent N rows per table (default 500).
 */
export function pruneOldRows(maxRows = 500): { pruned: Record<string, number> } {
  const db = getDatabase();
  const pruned: Record<string, number> = {};

  const tables: Array<{ table: string; orderCol: string }> = [
    { table: 'automation_runs', orderCol: 'started_at' },
    { table: 'scheduled_task_runs', orderCol: 'started_at' },
    { table: 'workflow_transitions', orderCol: 'created_at' },
  ];

  for (const { table, orderCol } of tables) {
    const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
    if (countRow.cnt > maxRows) {
      const result = db.prepare(
        `DELETE FROM ${table} WHERE id NOT IN (SELECT id FROM ${table} ORDER BY ${orderCol} DESC LIMIT ?)`,
      ).run(maxRows);
      pruned[table] = result.changes;
    }
  }

  return { pruned };
}
