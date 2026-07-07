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
  it('seeds a default template with the task and background instructions', () => {
    ensureDefaultTodoTemplate();
    const row = getDatabase()
      .prepare(`SELECT content FROM prompt_templates WHERE is_default = 1`)
      .get() as { content: string };
    expect(row.content).toContain('{{todo.id}}');
    expect(row.content).toContain('## Task');
    // The orchestrator flow lives in the agent prompt, not the template
    expect(row.content).not.toContain('orchestrate');
  });

  it('replaces a default row still referencing the retired orchestrate skill', () => {
    const db = getDatabase();
    db.prepare(`UPDATE prompt_templates SET content = ? WHERE is_default = 1`).run(
      '## Workflow\n\ninvoke the Skill tool with skill "orchestrate"\n\n## Task\n\n**{{todo.title}}**',
    );
    ensureDefaultTodoTemplate();
    const row = db
      .prepare(`SELECT content FROM prompt_templates WHERE is_default = 1`)
      .get() as { content: string };
    expect(row.content).not.toContain('orchestrate');
    expect(row.content).toContain('{{todo.id}}');
  });

  it('leaves an up-to-date default row untouched', () => {
    const db = getDatabase();
    const before = (db.prepare(`SELECT content, updated_at FROM prompt_templates WHERE is_default = 1`).get()) as { content: string; updated_at: string };
    ensureDefaultTodoTemplate();
    const after = (db.prepare(`SELECT content, updated_at FROM prompt_templates WHERE is_default = 1`).get()) as { content: string; updated_at: string };
    expect(after).toEqual(before);
  });
});
