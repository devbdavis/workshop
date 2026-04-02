import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { PromptTemplateRepository } from '@domain/prompt-template/repository';
import type { PromptTemplate, TemplateId } from '@foundation/types';

export function createPromptTemplateRepository(): PromptTemplateRepository {
  const db = getDatabase();

  // Prepare statements once
  const findAllStmt = db.prepare('SELECT * FROM prompt_templates ORDER BY is_default DESC, created_at ASC');
  const findByIdStmt = db.prepare('SELECT * FROM prompt_templates WHERE id = ?');
  const findDefaultStmt = db.prepare('SELECT * FROM prompt_templates WHERE is_default = 1 LIMIT 1');
  const insertStmt = db.prepare(
    'INSERT INTO prompt_templates (id, name, description, content, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const updateStmt = db.prepare(
    'UPDATE prompt_templates SET name = ?, description = ?, content = ?, updated_at = ? WHERE id = ?',
  );
  const deleteStmt = db.prepare('DELETE FROM prompt_templates WHERE id = ?');

  return {
    findAll(): PromptTemplate[] {
      const rows = findAllStmt.all() as TemplateRow[];
      return rows.map(rowToTemplate);
    },

    findById(id: TemplateId): PromptTemplate | null {
      const row = findByIdStmt.get(id) as TemplateRow | undefined;
      return row ? rowToTemplate(row) : null;
    },

    findDefault(): PromptTemplate | null {
      const row = findDefaultStmt.get() as TemplateRow | undefined;
      return row ? rowToTemplate(row) : null;
    },

    create(data): PromptTemplate {
      const id = uuid() as TemplateId;
      const now = new Date().toISOString();
      insertStmt.run(id, data.name, data.description || null, data.content, 0, now, now);
      return {
        id,
        name: data.name,
        description: data.description,
        content: data.content,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      };
    },

    update(id: TemplateId, data): PromptTemplate | null {
      const existing = this.findById(id);
      if (!existing) return null;
      const now = new Date().toISOString();
      const name = data.name ?? existing.name;
      const description = data.description ?? existing.description;
      const content = data.content ?? existing.content;
      updateStmt.run(name, description || null, content, now, id);
      return { ...existing, name, description, content, updatedAt: now };
    },

    delete(id: TemplateId): boolean {
      const result = deleteStmt.run(id);
      return result.changes > 0;
    },
  };
}

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  content: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

function rowToTemplate(row: TemplateRow): PromptTemplate {
  return {
    id: row.id as TemplateId,
    name: row.name,
    description: row.description || undefined,
    content: row.content,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
