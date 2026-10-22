import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

const testDbPath = path.join(os.tmpdir(), `workshop-test-ignore-${randomUUID()}.db`);
process.env.WORKSHOP_DB_PATH = testDbPath;

import { createIssueImportIgnoreRepository } from '@infrastructure/persistence/issue-import-ignore-repository';
import { resetDatabase } from '@infrastructure/persistence/database';

describe('IssueImportIgnoreRepository', () => {
  const repo = createIssueImportIgnoreRepository();

  afterAll(() => {
    resetDatabase();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it('adds and lists entries by source', () => {
    repo.add({ source: 'linear', externalId: 'ASY-1', cachedTitle: 'one', cachedUrl: 'https://linear.app/x/issue/ASY-1' });
    repo.add({ source: 'linear', externalId: 'ASY-2' });
    repo.add({ source: 'jira', externalId: 'PROJ-100' });

    const linear = repo.findBySource('linear');
    expect(linear).toHaveLength(2);
    expect(linear.map((e) => e.externalId).sort()).toEqual(['ASY-1', 'ASY-2']);
    expect(linear.find((e) => e.externalId === 'ASY-1')?.cachedTitle).toBe('one');
    expect(linear.find((e) => e.externalId === 'ASY-1')?.cachedUrl).toBe('https://linear.app/x/issue/ASY-1');

    const jira = repo.findBySource('jira');
    expect(jira).toHaveLength(1);
    expect(jira[0].externalId).toBe('PROJ-100');
  });

  it('is idempotent on repeated add (updates cached fields, preserves id/createdAt)', () => {
    const first = repo.add({ source: 'linear', externalId: 'DUP-1', cachedTitle: 'first' });
    const second = repo.add({ source: 'linear', externalId: 'DUP-1', cachedTitle: 'second', cachedUrl: 'https://x/DUP-1' });

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.cachedTitle).toBe('second');
    expect(second.cachedUrl).toBe('https://x/DUP-1');

    const linear = repo.findBySource('linear');
    const dup = linear.filter((e) => e.externalId === 'DUP-1');
    expect(dup).toHaveLength(1);
  });

  it('findOne returns the matching row or null', () => {
    repo.add({ source: 'linear', externalId: 'FIND-1' });
    expect(repo.findOne('linear', 'FIND-1')?.externalId).toBe('FIND-1');
    expect(repo.findOne('linear', 'MISSING')).toBeNull();
    expect(repo.findOne('jira', 'FIND-1')).toBeNull();
  });

  it('remove returns true when it deleted a row and false otherwise', () => {
    repo.add({ source: 'linear', externalId: 'DEL-1' });
    expect(repo.remove('linear', 'DEL-1')).toBe(true);
    expect(repo.remove('linear', 'DEL-1')).toBe(false);
    expect(repo.findOne('linear', 'DEL-1')).toBeNull();
  });
});
