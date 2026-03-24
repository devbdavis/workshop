import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { WorkflowTemplateRepository, WorkflowTemplateRow } from '@domain/workflow/template-repository.js';
import {
  StageDefinitionsSchema,
  MatchCriteriaSchema,
  PromptOverridesSchema,
} from '@domain/workflow/schemas.js';

// ---------------------------------------------------------------------------
// SQLite implementation of WorkflowTemplateRepository
// ---------------------------------------------------------------------------

export function createWorkflowTemplateRepository(): WorkflowTemplateRepository {
  const db = getDatabase();

  // Prepared statements
  const findByRowIdStmt = db.prepare('SELECT * FROM workflow_templates WHERE row_id = ?');
  const findLatestStmt = db.prepare('SELECT * FROM workflow_templates WHERE id = ? AND is_latest = true');
  const findByIdAndVersionStmt = db.prepare('SELECT * FROM workflow_templates WHERE id = ? AND version = ?');
  const findAllLatestStmt = db.prepare('SELECT * FROM workflow_templates WHERE is_latest = true ORDER BY name ASC');
  const findMaxVersionStmt = db.prepare('SELECT MAX(version) as max_version FROM workflow_templates WHERE id = ?');
  const findTaskByParentStmt = db.prepare(
    "SELECT * FROM workflow_templates WHERE parent_template_id = ? AND ticket_type = 'task' AND is_latest = true LIMIT 1",
  );

  const insertStmt = db.prepare(`
    INSERT INTO workflow_templates
    (row_id, id, version, name, description, ticket_type, stage_definitions,
     prompt_overrides, tags, match_criteria, usage_count, avg_rating,
     parent_template_id, is_latest, created_at, updated_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const clearLatestStmt = db.prepare('UPDATE workflow_templates SET is_latest = false WHERE id = ?');
  const incrementUsageStmt = db.prepare('UPDATE workflow_templates SET usage_count = usage_count + 1 WHERE row_id = ?');
  const updateRatingStmt = db.prepare('UPDATE workflow_templates SET avg_rating = ? WHERE row_id = ?');

  return {
    findByRowId(rowId: string): WorkflowTemplateRow | null {
      const row = findByRowIdStmt.get(rowId) as TemplateDbRow | undefined;
      return row ? rowToTemplate(row) : null;
    },

    findLatest(id: string): WorkflowTemplateRow | null {
      const row = findLatestStmt.get(id) as TemplateDbRow | undefined;
      return row ? rowToTemplate(row) : null;
    },

    findByIdAndVersion(id: string, version: number): WorkflowTemplateRow | null {
      const row = findByIdAndVersionStmt.get(id, version) as TemplateDbRow | undefined;
      return row ? rowToTemplate(row) : null;
    },

    findTaskTemplateByParent(parentTemplateId: string): WorkflowTemplateRow | null {
      const row = findTaskByParentStmt.get(parentTemplateId) as TemplateDbRow | undefined;
      return row ? rowToTemplate(row) : null;
    },

    findAllLatest(filters?: { ticketType?: string; tags?: string[] }): WorkflowTemplateRow[] {
      // For dynamic filtering, we build the query
      if (!filters || (!filters.ticketType && !filters.tags?.length)) {
        const rows = findAllLatestStmt.all() as TemplateDbRow[];
        return rows.map(rowToTemplate);
      }

      const clauses: string[] = ['is_latest = true'];
      const params: unknown[] = [];

      if (filters.ticketType) {
        clauses.push('ticket_type = ?');
        params.push(filters.ticketType);
      }

      // Tag filtering uses LIKE since tags is stored as JSON array
      if (filters.tags?.length) {
        const tagClauses = filters.tags.map(() => 'tags LIKE ?');
        clauses.push(`(${tagClauses.join(' OR ')})`);
        filters.tags.forEach(tag => params.push(`%"${tag}"%`));
      }

      const sql = `SELECT * FROM workflow_templates WHERE ${clauses.join(' AND ')} ORDER BY name ASC`;
      const rows = db.prepare(sql).all(...params) as TemplateDbRow[];
      return rows.map(rowToTemplate);
    },

    create(template: Omit<WorkflowTemplateRow, 'rowId' | 'createdAt' | 'updatedAt' | 'isLatest'>): WorkflowTemplateRow {
      const rowId = uuid();
      const now = new Date().toISOString();

      insertStmt.run(
        rowId,
        template.id,
        template.version,
        template.name,
        template.description,
        template.ticketType,
        JSON.stringify(template.stageDefinitions),
        template.promptOverrides ? JSON.stringify(template.promptOverrides) : null,
        template.tags ? JSON.stringify(template.tags) : null,
        template.matchCriteria ? JSON.stringify(template.matchCriteria) : null,
        template.usageCount,
        template.avgRating ?? null,
        template.parentTemplateId ?? null,
        1,  // is_latest — SQLite integer (boolean)
        now,
        now,
        template.createdBy,
      );

      return {
        rowId,
        ...template,
        isLatest: true,
        createdAt: now,
        updatedAt: now,
      };
    },

    createNewVersion(id: string, changes: Partial<WorkflowTemplateRow>): WorkflowTemplateRow {
      const existing = this.findLatest(id);
      if (!existing) {
        throw new Error(`Template not found: ${id}`);
      }

      // Get next version number
      const versionRow = findMaxVersionStmt.get(id) as { max_version: number | null } | undefined;
      const nextVersion = (versionRow?.max_version ?? 0) + 1;

      // Use transaction to ensure atomicity
      const createVersionTx = db.transaction(() => {
        // Clear is_latest on all existing versions
        clearLatestStmt.run(id);

        // Create new version
        const rowId = uuid();
        const now = new Date().toISOString();

        const merged = {
          ...existing,
          ...changes,
          rowId,
          id,
          version: nextVersion,
          isLatest: true,
          createdAt: now,
          updatedAt: now,
        };

        insertStmt.run(
          merged.rowId,
          merged.id,
          merged.version,
          merged.name,
          merged.description,
          merged.ticketType,
          JSON.stringify(merged.stageDefinitions),
          merged.promptOverrides ? JSON.stringify(merged.promptOverrides) : null,
          merged.tags ? JSON.stringify(merged.tags) : null,
          merged.matchCriteria ? JSON.stringify(merged.matchCriteria) : null,
          merged.usageCount,
          merged.avgRating ?? null,
          merged.parentTemplateId ?? null,
          merged.isLatest ? 1 : 0,  // SQLite integer (boolean)
          merged.createdAt,
          merged.updatedAt,
          merged.createdBy,
        );

        return merged;
      });

      return createVersionTx();
    },

    incrementUsage(rowId: string): void {
      incrementUsageStmt.run(rowId);
    },

    updateRating(rowId: string, rating: number): void {
      updateRatingStmt.run(rating, rowId);
    },
  };
}

// ---------------------------------------------------------------------------
// Row type and mapper
// ---------------------------------------------------------------------------

interface TemplateDbRow {
  row_id: string;
  id: string;
  version: number;
  name: string;
  description: string;
  ticket_type: string;
  stage_definitions: string;
  prompt_overrides: string | null;
  tags: string | null;
  match_criteria: string | null;
  usage_count: number;
  avg_rating: number | null;
  parent_template_id: string | null;
  is_latest: number;
  created_at: string;
  updated_at: string;
  created_by: string;
}

function rowToTemplate(row: TemplateDbRow): WorkflowTemplateRow {
  return {
    rowId: row.row_id,
    id: row.id,
    version: row.version,
    name: row.name,
    description: row.description,
    ticketType: row.ticket_type as 'epic' | 'task',
    stageDefinitions: StageDefinitionsSchema.parse(JSON.parse(row.stage_definitions)),
    promptOverrides: row.prompt_overrides
      ? PromptOverridesSchema.parse(JSON.parse(row.prompt_overrides))
      : undefined,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : undefined,
    matchCriteria: row.match_criteria
      ? MatchCriteriaSchema.parse(JSON.parse(row.match_criteria))
      : undefined,
    usageCount: row.usage_count,
    avgRating: row.avg_rating ?? undefined,
    parentTemplateId: row.parent_template_id ?? undefined,
    isLatest: row.is_latest === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}
