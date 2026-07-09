import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { PluginRepository } from '@domain/plugin/repository';
import type { Plugin, PluginId, PluginProviders } from '@foundation/types';

interface PluginRow {
  id: string;
  marketplace_repo: string;
  plugin_name: string;
  description: string | null;
  enabled: number;
  providers: string | null;
  created_at: string;
  updated_at: string;
}

function rowToPlugin(row: PluginRow): Plugin {
  return {
    id: row.id as PluginId,
    marketplaceRepo: row.marketplace_repo,
    pluginName: row.plugin_name,
    description: row.description ?? undefined,
    enabled: row.enabled === 1,
    providers: row.providers ? (JSON.parse(row.providers) as PluginProviders) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPluginRepository(): PluginRepository {
  const db = getDatabase();

  const findAllStmt = db.prepare('SELECT * FROM plugins ORDER BY plugin_name ASC');
  const findByIdStmt = db.prepare('SELECT * FROM plugins WHERE id = ?');
  const findByNameStmt = db.prepare('SELECT * FROM plugins WHERE plugin_name = ?');
  const insertStmt = db.prepare(
    `INSERT INTO plugins (id, marketplace_repo, plugin_name, description, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateStmt = db.prepare(
    `UPDATE plugins SET description = ?, enabled = ?, providers = ?, updated_at = ? WHERE id = ?`,
  );
  const deleteStmt = db.prepare('DELETE FROM plugins WHERE id = ?');

  return {
    findAll(): Plugin[] {
      const rows = findAllStmt.all() as PluginRow[];
      return rows.map(rowToPlugin);
    },

    findById(id: PluginId): Plugin | null {
      const row = findByIdStmt.get(id) as PluginRow | undefined;
      return row ? rowToPlugin(row) : null;
    },

    findByName(pluginName: string): Plugin | null {
      const row = findByNameStmt.get(pluginName) as PluginRow | undefined;
      return row ? rowToPlugin(row) : null;
    },

    create(data): Plugin {
      const id = uuid() as PluginId;
      const now = new Date().toISOString();
      const enabled = data.enabled ?? true;
      insertStmt.run(id, data.marketplaceRepo, data.pluginName, data.description ?? null, enabled ? 1 : 0, now, now);
      return {
        id,
        marketplaceRepo: data.marketplaceRepo,
        pluginName: data.pluginName,
        description: data.description,
        enabled,
        createdAt: now,
        updatedAt: now,
      };
    },

    update(id: PluginId, data): Plugin | null {
      const existing = findByIdStmt.get(id) as PluginRow | undefined;
      if (!existing) return null;
      const current = rowToPlugin(existing);
      const description = data.description !== undefined ? data.description : current.description;
      const enabled = data.enabled !== undefined ? data.enabled : current.enabled;
      const providers = data.providers !== undefined ? data.providers : current.providers;
      updateStmt.run(
        description ?? null,
        enabled ? 1 : 0,
        providers ? JSON.stringify(providers) : null,
        new Date().toISOString(),
        id,
      );
      const row = findByIdStmt.get(id) as PluginRow;
      return rowToPlugin(row);
    },

    delete(id: PluginId): boolean {
      const result = deleteStmt.run(id);
      return result.changes > 0;
    },
  };
}
