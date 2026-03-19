import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { McpServerConfigRepository } from '@domain/mcp-config/repository';
import type { McpServerConfig, McpServerConfigId, McpTransportType } from '@foundation/types';

export function createMcpServerConfigRepository(): McpServerConfigRepository {
  const db = getDatabase();

  const findAllStmt = db.prepare('SELECT * FROM mcp_server_configs ORDER BY name ASC');
  const findByIdStmt = db.prepare('SELECT * FROM mcp_server_configs WHERE id = ?');
  const findByNameStmt = db.prepare('SELECT * FROM mcp_server_configs WHERE name = ?');
  const insertStmt = db.prepare(
    `INSERT INTO mcp_server_configs (id, name, transport_type, command, args, env, url, headers, enabled, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateStmt = db.prepare(
    `UPDATE mcp_server_configs SET name = ?, transport_type = ?, command = ?, args = ?, env = ?, url = ?, headers = ?, enabled = ?, updated_at = ?
     WHERE id = ?`,
  );
  const deleteStmt = db.prepare('DELETE FROM mcp_server_configs WHERE id = ?');

  return {
    findAll(): McpServerConfig[] {
      const rows = findAllStmt.all() as McpConfigRow[];
      return rows.map(rowToConfig);
    },

    findById(id: McpServerConfigId): McpServerConfig | null {
      const row = findByIdStmt.get(id) as McpConfigRow | undefined;
      return row ? rowToConfig(row) : null;
    },

    findByName(name: string): McpServerConfig | null {
      const row = findByNameStmt.get(name) as McpConfigRow | undefined;
      return row ? rowToConfig(row) : null;
    },

    create(data): McpServerConfig {
      const id = uuid() as McpServerConfigId;
      const now = new Date().toISOString();
      insertStmt.run(
        id,
        data.name,
        data.transportType,
        data.command || null,
        data.args ? JSON.stringify(data.args) : null,
        data.env ? JSON.stringify(data.env) : null,
        data.url || null,
        data.headers ? JSON.stringify(data.headers) : null,
        data.enabled ? 1 : 0,
        data.source,
        now,
        now,
      );
      return { id, ...data, createdAt: now, updatedAt: now };
    },

    update(id, data): McpServerConfig | null {
      const existing = this.findById(id);
      if (!existing) return null;
      const now = new Date().toISOString();
      const name = data.name ?? existing.name;
      const transportType = data.transportType ?? existing.transportType;
      const command = data.command !== undefined ? data.command : existing.command;
      const args = data.args !== undefined ? data.args : existing.args;
      const env = data.env !== undefined ? data.env : existing.env;
      const url = data.url !== undefined ? data.url : existing.url;
      const headers = data.headers !== undefined ? data.headers : existing.headers;
      const enabled = data.enabled !== undefined ? data.enabled : existing.enabled;
      updateStmt.run(
        name,
        transportType,
        command || null,
        args ? JSON.stringify(args) : null,
        env ? JSON.stringify(env) : null,
        url || null,
        headers ? JSON.stringify(headers) : null,
        enabled ? 1 : 0,
        now,
        id,
      );
      return {
        ...existing, name, transportType, command, args, env, url, headers, enabled,
        updatedAt: now,
      };
    },

    upsertByName(data): McpServerConfig {
      const existing = this.findByName(data.name);
      if (existing) {
        return this.update(existing.id, {
          transportType: data.transportType,
          command: data.command,
          args: data.args,
          env: data.env,
          url: data.url,
          headers: data.headers,
          enabled: data.enabled,
        })!;
      }
      return this.create(data);
    },

    delete(id: McpServerConfigId): boolean {
      const result = deleteStmt.run(id);
      return result.changes > 0;
    },
  };
}

interface McpConfigRow {
  id: string;
  name: string;
  transport_type: string;
  command: string | null;
  args: string | null;
  env: string | null;
  url: string | null;
  headers: string | null;
  enabled: number;
  source: string;
  created_at: string;
  updated_at: string;
}

function rowToConfig(row: McpConfigRow): McpServerConfig {
  return {
    id: row.id as McpServerConfigId,
    name: row.name,
    transportType: row.transport_type as McpTransportType,
    command: row.command || undefined,
    args: row.args ? JSON.parse(row.args) : undefined,
    env: row.env ? JSON.parse(row.env) : undefined,
    url: row.url || undefined,
    headers: row.headers ? JSON.parse(row.headers) : undefined,
    enabled: row.enabled === 1,
    source: row.source as McpServerConfig['source'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
