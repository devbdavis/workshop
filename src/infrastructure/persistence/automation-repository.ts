import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { AutomationRuleRepository, AutomationRunRepository } from '@domain/automation/repository';
import type {
  AutomationRule,
  AutomationRuleId,
  AutomationRun,
  TrackId,
  TriggerType,
} from '@foundation/types';

// --- Rule Repository ---

export function createAutomationRuleRepository(): AutomationRuleRepository {
  const db = getDatabase();

  return {
    findById(id: AutomationRuleId): AutomationRule | null {
      const row = db.prepare('SELECT * FROM automation_rules WHERE id = ?').get(id) as RuleRow | undefined;
      return row ? rowToRule(row) : null;
    },

    findByTrack(trackId: TrackId): AutomationRule[] {
      const rows = db
        .prepare('SELECT * FROM automation_rules WHERE track_id = ? ORDER BY created_at DESC')
        .all(trackId) as RuleRow[];
      return rows.map(rowToRule);
    },

    findByTriggerType(triggerType: TriggerType): AutomationRule[] {
      const rows = db
        .prepare('SELECT * FROM automation_rules WHERE trigger_type = ? ORDER BY created_at DESC')
        .all(triggerType) as RuleRow[];
      return rows.map(rowToRule);
    },

    findEnabled(): AutomationRule[] {
      const rows = db
        .prepare('SELECT * FROM automation_rules WHERE enabled = 1 ORDER BY created_at DESC')
        .all() as RuleRow[];
      return rows.map(rowToRule);
    },

    create(data): AutomationRule {
      const id = uuid() as AutomationRuleId;
      const now = new Date().toISOString();
      const triggerConfig = data.triggerConfig ? JSON.stringify(data.triggerConfig) : null;
      const actionConfig = data.actionConfig ? JSON.stringify(data.actionConfig) : null;

      db.prepare(
        `INSERT INTO automation_rules (id, track_id, name, trigger_type, trigger_config, action_type, action_config, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, data.trackId, data.name, data.triggerType, triggerConfig, data.actionType, actionConfig, data.enabled ? 1 : 0, now, now);

      return {
        id,
        trackId: data.trackId,
        name: data.name,
        triggerType: data.triggerType,
        triggerConfig: data.triggerConfig,
        actionType: data.actionType,
        actionConfig: data.actionConfig,
        enabled: data.enabled,
        createdAt: now,
        updatedAt: now,
      };
    },

    update(id, data): AutomationRule | null {
      const existing = this.findById(id);
      if (!existing) return null;

      const now = new Date().toISOString();
      const name = data.name ?? existing.name;
      const triggerType = data.triggerType ?? existing.triggerType;
      const triggerConfig = data.triggerConfig !== undefined ? data.triggerConfig : existing.triggerConfig;
      const actionType = data.actionType ?? existing.actionType;
      const actionConfig = data.actionConfig !== undefined ? data.actionConfig : existing.actionConfig;
      const enabled = data.enabled !== undefined ? data.enabled : existing.enabled;

      db.prepare(
        `UPDATE automation_rules
         SET name = ?, trigger_type = ?, trigger_config = ?, action_type = ?, action_config = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        name,
        triggerType,
        triggerConfig ? JSON.stringify(triggerConfig) : null,
        actionType,
        actionConfig ? JSON.stringify(actionConfig) : null,
        enabled ? 1 : 0,
        now,
        id,
      );

      return { ...existing, name, triggerType, triggerConfig, actionType, actionConfig, enabled, updatedAt: now };
    },

    delete(id: AutomationRuleId): boolean {
      const result = db.prepare('DELETE FROM automation_rules WHERE id = ?').run(id);
      return result.changes > 0;
    },
  };
}

// --- Run Repository ---

export function createAutomationRunRepository(): AutomationRunRepository {
  const db = getDatabase();

  return {
    findByRule(ruleId: AutomationRuleId): AutomationRun[] {
      const rows = db
        .prepare('SELECT * FROM automation_runs WHERE rule_id = ? ORDER BY started_at DESC')
        .all(ruleId) as RunRow[];
      return rows.map(rowToRun);
    },

    create(data): AutomationRun {
      const id = uuid();
      const resultJson = data.result ? JSON.stringify(data.result) : null;

      db.prepare(
        `INSERT INTO automation_runs (id, rule_id, status, result, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, data.ruleId, data.status, resultJson, data.startedAt, data.completedAt || null);

      return { id, ruleId: data.ruleId, status: data.status, result: data.result, startedAt: data.startedAt, completedAt: data.completedAt };
    },

    complete(id, status, result): AutomationRun | null {
      const now = new Date().toISOString();
      const resultJson = result ? JSON.stringify(result) : null;

      const updateResult = db.prepare(
        'UPDATE automation_runs SET status = ?, result = ?, completed_at = ? WHERE id = ?',
      ).run(status, resultJson, now, id);

      if (updateResult.changes === 0) return null;

      const row = db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id) as RunRow | undefined;
      return row ? rowToRun(row) : null;
    },
  };
}

// --- Row types and mappers ---

interface RuleRow {
  id: string;
  track_id: string;
  name: string;
  trigger_type: string;
  trigger_config: string | null;
  action_type: string;
  action_config: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  rule_id: string;
  status: string;
  result: string | null;
  started_at: string;
  completed_at: string | null;
}

function rowToRule(row: RuleRow): AutomationRule {
  return {
    id: row.id as AutomationRuleId,
    trackId: row.track_id as TrackId,
    name: row.name,
    triggerType: row.trigger_type as TriggerType,
    triggerConfig: row.trigger_config ? JSON.parse(row.trigger_config) : undefined,
    actionType: row.action_type as AutomationRule['actionType'],
    actionConfig: row.action_config ? JSON.parse(row.action_config) : undefined,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRun(row: RunRow): AutomationRun {
  return {
    id: row.id,
    ruleId: row.rule_id as AutomationRuleId,
    status: row.status as AutomationRun['status'],
    result: row.result ? JSON.parse(row.result) : undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at || undefined,
  };
}
