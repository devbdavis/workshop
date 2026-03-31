import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { GlobalRepoRepository, SettingsRepository } from '@domain/repo/repository';
import type { GlobalRepo, GlobalRepoId } from '@foundation/types';

interface RepoRow {
  id: string;
  path: string;
  name: string;
  main_branch: string;
  created_at: string;
  updated_at: string;
}

function rowToRepo(row: RepoRow): GlobalRepo {
  return {
    id: row.id as GlobalRepoId,
    path: row.path,
    name: row.name,
    mainBranch: row.main_branch as 'main' | 'master',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createGlobalRepoRepository(): GlobalRepoRepository {
  const db = getDatabase();

  const findAllStmt = db.prepare('SELECT * FROM repos ORDER BY name ASC');
  const findByIdStmt = db.prepare('SELECT * FROM repos WHERE id = ?');
  const findByPathStmt = db.prepare('SELECT * FROM repos WHERE path = ?');
  const insertStmt = db.prepare(
    'INSERT INTO repos (id, path, name, main_branch, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const deleteStmt = db.prepare('DELETE FROM repos WHERE id = ?');

  return {
    findAll(): GlobalRepo[] {
      const rows = findAllStmt.all() as RepoRow[];
      return rows.map(rowToRepo);
    },

    findById(id: GlobalRepoId): GlobalRepo | null {
      const row = findByIdStmt.get(id) as RepoRow | undefined;
      return row ? rowToRepo(row) : null;
    },

    findByPath(path: string): GlobalRepo | null {
      const row = findByPathStmt.get(path) as RepoRow | undefined;
      return row ? rowToRepo(row) : null;
    },

    create(data): GlobalRepo {
      const id = uuid() as GlobalRepoId;
      const now = new Date().toISOString();
      insertStmt.run(id, data.path, data.name, data.mainBranch, now, now);
      return { id, path: data.path, name: data.name, mainBranch: data.mainBranch, createdAt: now, updatedAt: now };
    },

    delete(id: GlobalRepoId): boolean {
      const result = deleteStmt.run(id);
      return result.changes > 0;
    },
  };
}

export function createSettingsRepository(): SettingsRepository {
  const db = getDatabase();

  const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

  return {
    get(key: string): string | null {
      const row = getStmt.get(key) as { value: string } | undefined;
      return row ? row.value : null;
    },

    set(key: string, value: string): void {
      setStmt.run(key, value);
    },
  };
}
