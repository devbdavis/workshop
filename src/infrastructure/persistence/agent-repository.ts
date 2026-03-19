import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { AgentRepository } from '@domain/agent/repository';
import type { Agent, AgentId, SessionProvider } from '@foundation/types';

export function createAgentRepository(): AgentRepository {
  const db = getDatabase();

  // Prepare statements once
  const findAllStmt = db.prepare('SELECT * FROM agents ORDER BY created_at ASC');
  const findByIdStmt = db.prepare('SELECT * FROM agents WHERE id = ?');
  const insertStmt = db.prepare(
    `INSERT INTO agents (id, name, description, model, provider, color, system_prompt, allowed_tools, max_turns, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateStmt = db.prepare(
    `UPDATE agents SET name = ?, description = ?, model = ?, provider = ?, color = ?, system_prompt = ?, allowed_tools = ?, max_turns = ?, updated_at = ?
     WHERE id = ?`,
  );
  const deleteStmt = db.prepare('DELETE FROM agents WHERE id = ?');

  return {
    findAll(): Agent[] {
      const rows = findAllStmt.all() as AgentRow[];
      return rows.map(rowToAgent);
    },

    findById(id: AgentId): Agent | null {
      const row = findByIdStmt.get(id) as AgentRow | undefined;
      return row ? rowToAgent(row) : null;
    },

    create(data): Agent {
      const id = uuid() as AgentId;
      const now = new Date().toISOString();
      const allowedToolsJson = data.allowedTools ? JSON.stringify(data.allowedTools) : null;
      insertStmt.run(
        id,
        data.name,
        data.description,
        data.model || null,
        data.provider || null,
        data.color || null,
        data.systemPrompt,
        allowedToolsJson,
        data.maxTurns ?? null,
        now,
        now,
      );
      return {
        id,
        name: data.name,
        description: data.description,
        model: data.model,
        provider: data.provider,
        color: data.color,
        systemPrompt: data.systemPrompt,
        source: 'workshop',
        allowedTools: data.allowedTools,
        maxTurns: data.maxTurns,
        createdAt: now,
        updatedAt: now,
      };
    },

    update(id: AgentId, data): Agent | null {
      const existing = this.findById(id);
      if (!existing) return null;
      const now = new Date().toISOString();
      const name = data.name ?? existing.name;
      const description = data.description ?? existing.description;
      const model = data.model !== undefined ? data.model : existing.model;
      const provider = data.provider !== undefined ? data.provider : existing.provider;
      const color = data.color !== undefined ? data.color : existing.color;
      const systemPrompt = data.systemPrompt ?? existing.systemPrompt;
      const allowedTools = data.allowedTools !== undefined ? data.allowedTools : existing.allowedTools;
      const maxTurns = data.maxTurns !== undefined ? data.maxTurns : existing.maxTurns;
      const allowedToolsJson = allowedTools ? JSON.stringify(allowedTools) : null;
      updateStmt.run(name, description, model || null, provider || null, color || null, systemPrompt, allowedToolsJson, maxTurns ?? null, now, id);
      return {
        ...existing,
        name,
        description,
        model,
        provider,
        color,
        systemPrompt,
        allowedTools,
        maxTurns,
        updatedAt: now,
      };
    },

    delete(id: AgentId): boolean {
      const result = deleteStmt.run(id);
      return result.changes > 0;
    },
  };
}

interface AgentRow {
  id: string;
  name: string;
  description: string;
  model: string | null;
  provider: string | null;
  color: string | null;
  system_prompt: string;
  allowed_tools: string | null;
  max_turns: number | null;
  created_at: string;
  updated_at: string;
}

function rowToAgent(row: AgentRow): Agent {
  return {
    id: row.id as AgentId,
    name: row.name,
    description: row.description,
    model: row.model || undefined,
    provider: (row.provider as SessionProvider) || undefined,
    color: row.color || undefined,
    systemPrompt: row.system_prompt,
    source: 'workshop',
    allowedTools: row.allowed_tools ? JSON.parse(row.allowed_tools) : undefined,
    maxTurns: row.max_turns ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
