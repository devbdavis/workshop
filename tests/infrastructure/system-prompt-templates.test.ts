import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getDatabase,
  resetDatabase,
  ensureSystemPromptTemplates,
  LEGACY_PR_COMMENT_RESPONSE_CONTENTS,
  LEGACY_PR_BUILD_FIX_CONTENTS,
} from '@infrastructure/persistence/database';

let workDir: string;
let previousDbPath: string | undefined;

beforeAll(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), 'workshop-system-template-test-'));
  previousDbPath = process.env.WORKSHOP_DB_PATH;
  process.env.WORKSHOP_DB_PATH = path.join(workDir, 'workshop.db');
});

afterAll(() => {
  resetDatabase();
  if (previousDbPath !== undefined) process.env.WORKSHOP_DB_PATH = previousDbPath;
  else delete process.env.WORKSHOP_DB_PATH;
  rmSync(workDir, { recursive: true, force: true });
});

function commentTemplate(): { content: string; updated_at: string } {
  return getDatabase()
    .prepare(`SELECT content, updated_at FROM prompt_templates WHERE system_kind = 'pr-comment-response'`)
    .get() as { content: string; updated_at: string };
}

describe('ensureSystemPromptTemplates — pr-comment-response', () => {
  it('seeds the short send-to-session default (no stand-alone sub-agent framing)', () => {
    ensureSystemPromptTemplates();
    const { content } = commentTemplate();
    expect(content).toContain('{{pr.comments}}');
    expect(content).not.toContain('background sub-agent');
  });

  it('upgrades an un-edited row still holding a legacy default in place', () => {
    const db = getDatabase();
    db.prepare(`UPDATE prompt_templates SET content = ? WHERE system_kind = 'pr-comment-response'`)
      .run(LEGACY_PR_COMMENT_RESPONSE_CONTENTS[0]);
    ensureSystemPromptTemplates();
    const { content } = commentTemplate();
    expect(content).not.toContain('background sub-agent');
    expect(content).toContain('{{pr.comments}}');
  });

  it('leaves a user-edited row untouched', () => {
    const db = getDatabase();
    const custom = 'My house style: address {{pr.comments}} politely.';
    db.prepare(`UPDATE prompt_templates SET content = ? WHERE system_kind = 'pr-comment-response'`).run(custom);
    ensureSystemPromptTemplates();
    expect(commentTemplate().content).toBe(custom);
  });
});

function buildFixTemplate(): { content: string } {
  return getDatabase()
    .prepare(`SELECT content FROM prompt_templates WHERE system_kind = 'pr-build-fix'`)
    .get() as { content: string };
}

describe('ensureSystemPromptTemplates — pr-build-fix', () => {
  it('seeds the short send-to-session default (no stand-alone sub-agent framing)', () => {
    ensureSystemPromptTemplates();
    const { content } = buildFixTemplate();
    expect(content).toContain('{{pr.failing_checks}}');
    expect(content).not.toContain('background sub-agent');
  });

  it('upgrades an un-edited row still holding a legacy default in place', () => {
    const db = getDatabase();
    db.prepare(`UPDATE prompt_templates SET content = ? WHERE system_kind = 'pr-build-fix'`)
      .run(LEGACY_PR_BUILD_FIX_CONTENTS[0]);
    ensureSystemPromptTemplates();
    const { content } = buildFixTemplate();
    expect(content).not.toContain('background sub-agent');
    expect(content).toContain('{{pr.failing_checks}}');
  });

  it('leaves a user-edited row untouched', () => {
    const db = getDatabase();
    const custom = 'House style: fix {{pr.failing_checks}} carefully.';
    db.prepare(`UPDATE prompt_templates SET content = ? WHERE system_kind = 'pr-build-fix'`).run(custom);
    ensureSystemPromptTemplates();
    expect(buildFixTemplate().content).toBe(custom);
  });
});
