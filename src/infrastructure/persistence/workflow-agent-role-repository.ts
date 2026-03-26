import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { AgentRoleRepository, AgentRoleRow } from '@domain/workflow/agent-role-repository.js';
import { PromptBlockSchema } from '@domain/workflow/schemas.js';
import type { CapabilityTier } from '@domain/workflow/types.js';

// ---------------------------------------------------------------------------
// SQLite implementation of AgentRoleRepository
// ---------------------------------------------------------------------------

export function createAgentRoleRepository(): AgentRoleRepository {
  const db = getDatabase();

  // Prepared statements
  const findByIdStmt = db.prepare('SELECT * FROM workflow_agent_roles WHERE id = ?');
  const findByNameStmt = db.prepare('SELECT * FROM workflow_agent_roles WHERE name = ?');
  const findAllStmt = db.prepare('SELECT * FROM workflow_agent_roles ORDER BY name ASC');
  const findReusableStmt = db.prepare('SELECT * FROM workflow_agent_roles WHERE reusable = true ORDER BY name ASC');

  const insertStmt = db.prepare(`
    INSERT INTO workflow_agent_roles
    (id, name, description, prompt_block, tools_allowed, capability_tier,
     created_by_template_row_id, reusable, usage_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateStmt = db.prepare(`
    UPDATE workflow_agent_roles SET
      name = ?, description = ?, prompt_block = ?, tools_allowed = ?,
      capability_tier = ?, created_by_template_row_id = ?, reusable = ?, updated_at = ?
    WHERE id = ?
  `);

  const incrementUsageStmt = db.prepare(
    'UPDATE workflow_agent_roles SET usage_count = usage_count + 1 WHERE id = ?',
  );

  return {
    findById(id: string): AgentRoleRow | null {
      const row = findByIdStmt.get(id) as AgentRoleDbRow | undefined;
      return row ? rowToAgentRole(row) : null;
    },

    findByName(name: string): AgentRoleRow | null {
      const row = findByNameStmt.get(name) as AgentRoleDbRow | undefined;
      return row ? rowToAgentRole(row) : null;
    },

    findAll(filters?: { capabilityTier?: string; reusable?: boolean }): AgentRoleRow[] {
      // For simple filters, use precompiled or dynamic queries
      if (!filters || (filters.capabilityTier === undefined && filters.reusable === undefined)) {
        const rows = findAllStmt.all() as AgentRoleDbRow[];
        return rows.map(rowToAgentRole);
      }

      if (filters.reusable === true && filters.capabilityTier === undefined) {
        const rows = findReusableStmt.all() as AgentRoleDbRow[];
        return rows.map(rowToAgentRole);
      }

      // Dynamic query for other filter combinations
      const clauses: string[] = [];
      const params: unknown[] = [];

      if (filters.capabilityTier !== undefined) {
        clauses.push('capability_tier = ?');
        params.push(filters.capabilityTier);
      }

      if (filters.reusable !== undefined) {
        clauses.push('reusable = ?');
        params.push(filters.reusable ? 1 : 0);
      }

      const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
      const sql = `SELECT * FROM workflow_agent_roles${where} ORDER BY name ASC`;
      const rows = db.prepare(sql).all(...params) as AgentRoleDbRow[];
      return rows.map(rowToAgentRole);
    },

    create(role: Omit<AgentRoleRow, 'createdAt' | 'updatedAt' | 'usageCount'>): AgentRoleRow {
      const now = new Date().toISOString();
      const id = role.id || uuid();

      insertStmt.run(
        id,
        role.name,
        role.description,
        JSON.stringify(role.promptBlock),
        role.toolsAllowed ? JSON.stringify(role.toolsAllowed) : null,
        role.capabilityTier,
        role.createdByPlaybookRowId ?? null,
        role.reusable ? 1 : 0,
        0,
        now,
        now,
      );

      return {
        ...role,
        id,
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
      };
    },

    update(id: string, changes: Partial<AgentRoleRow>): AgentRoleRow | null {
      const existing = this.findById(id);
      if (!existing) return null;

      const now = new Date().toISOString();
      const merged: AgentRoleRow = {
        ...existing,
        name: changes.name ?? existing.name,
        description: changes.description ?? existing.description,
        promptBlock: changes.promptBlock ?? existing.promptBlock,
        toolsAllowed: changes.toolsAllowed !== undefined ? changes.toolsAllowed : existing.toolsAllowed,
        capabilityTier: changes.capabilityTier ?? existing.capabilityTier,
        createdByPlaybookRowId: changes.createdByPlaybookRowId !== undefined
          ? changes.createdByPlaybookRowId
          : existing.createdByPlaybookRowId,
        reusable: changes.reusable ?? existing.reusable,
        updatedAt: now,
      };

      updateStmt.run(
        merged.name,
        merged.description,
        JSON.stringify(merged.promptBlock),
        merged.toolsAllowed ? JSON.stringify(merged.toolsAllowed) : null,
        merged.capabilityTier,
        merged.createdByPlaybookRowId ?? null,
        merged.reusable ? 1 : 0,
        merged.updatedAt,
        id,
      );

      return merged;
    },

    incrementUsage(id: string): void {
      incrementUsageStmt.run(id);
    },
  };
}

// ---------------------------------------------------------------------------
// Row type and mapper
// ---------------------------------------------------------------------------

interface AgentRoleDbRow {
  id: string;
  name: string;
  description: string;
  prompt_block: string;
  tools_allowed: string | null;
  capability_tier: string;
  created_by_template_row_id: string | null;
  reusable: number;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

function rowToAgentRole(row: AgentRoleDbRow): AgentRoleRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    promptBlock: PromptBlockSchema.parse(JSON.parse(row.prompt_block)),
    toolsAllowed: row.tools_allowed ? (JSON.parse(row.tools_allowed) as string[]) : undefined,
    capabilityTier: row.capability_tier as CapabilityTier,
    createdByPlaybookRowId: row.created_by_template_row_id ?? undefined,
    reusable: row.reusable === 1,
    usageCount: row.usage_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
