import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDatabase, resetDatabase, ensureDefaultTodoTemplate } from '@infrastructure/persistence/database';

let workDir: string;
let previousDbPath: string | undefined;

beforeAll(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), 'workshop-todo-template-test-'));
  previousDbPath = process.env.WORKSHOP_DB_PATH;
  process.env.WORKSHOP_DB_PATH = path.join(workDir, 'workshop.db');
});

afterAll(() => {
  resetDatabase();
  if (previousDbPath !== undefined) process.env.WORKSHOP_DB_PATH = previousDbPath;
  else delete process.env.WORKSHOP_DB_PATH;
  rmSync(workDir, { recursive: true, force: true });
});

describe('ensureDefaultTodoTemplate', () => {
  it('seeds a default template containing the orchestrate workflow section', () => {
    ensureDefaultTodoTemplate();
    const row = getDatabase()
      .prepare(`SELECT content FROM prompt_templates WHERE is_default = 1`)
      .get() as { content: string };
    expect(row.content).toContain('orchestrate');
    expect(row.content).toContain('## Workflow');
    expect(row.content).toContain('{{todo.id}}');
  });

  it('upgrades an existing default row that predates the workflow section', () => {
    const db = getDatabase();
    db.prepare(`UPDATE prompt_templates SET content = ? WHERE is_default = 1`).run(
      '## Task\n\n**{{todo.title}}**\n\n{{todo.description}}',
    );
    ensureDefaultTodoTemplate();
    const row = db
      .prepare(`SELECT content FROM prompt_templates WHERE is_default = 1`)
      .get() as { content: string };
    expect(row.content).toContain('## Workflow');
  });

  it('leaves an up-to-date default row untouched', () => {
    const db = getDatabase();
    const before = (db.prepare(`SELECT content, updated_at FROM prompt_templates WHERE is_default = 1`).get()) as { content: string; updated_at: string };
    ensureDefaultTodoTemplate();
    const after = (db.prepare(`SELECT content, updated_at FROM prompt_templates WHERE is_default = 1`).get()) as { content: string; updated_at: string };
    expect(after).toEqual(before);
  });
});
