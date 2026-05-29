import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDatabase, resetDatabase, ensureSystemPromptTemplates } from '@infrastructure/persistence/database';
import { createPrMonitorRepository } from '@infrastructure/persistence/pr-monitor-repository';
import type { TodoId, TrackId } from '@foundation/types';

let workDir: string;
let previousDbPath: string | undefined;

beforeAll(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), 'workshop-pr-monitor-test-'));
  previousDbPath = process.env.WORKSHOP_DB_PATH;
  process.env.WORKSHOP_DB_PATH = path.join(workDir, 'workshop.db');
});

afterAll(() => {
  resetDatabase();
  if (previousDbPath !== undefined) process.env.WORKSHOP_DB_PATH = previousDbPath;
  else delete process.env.WORKSHOP_DB_PATH;
  rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
  // Reset rows between tests but keep schema (cheaper than recreating the db).
  const db = getDatabase();
  db.exec('DELETE FROM pr_monitors');
  db.exec('DELETE FROM todos');
  db.exec('DELETE FROM tracks');
});

function seedTrackAndTodo(): { trackId: TrackId; todoId: TodoId } {
  const db = getDatabase();
  const now = new Date().toISOString();
  const trackId = `track-${Math.random().toString(36).slice(2, 8)}` as TrackId;
  const todoId = `todo-${Math.random().toString(36).slice(2, 8)}` as TodoId;
  db.prepare(
    `INSERT INTO tracks (id, name, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)`,
  ).run(trackId, 'Test Track', now, now);
  db.prepare(
    `INSERT INTO todos (id, track_id, title, status, priority, refined, sort_order, created_at, updated_at)
     VALUES (?, ?, 'todo', 'review', 'medium', 0, 0, ?, ?)`,
  ).run(todoId, trackId, now, now);
  return { trackId, todoId };
}

describe('PrMonitorRepository', () => {
  it('registers a monitor and reads it back', () => {
    const { trackId, todoId } = seedTrackAndTodo();
    const repo = createPrMonitorRepository();

    const monitor = repo.register({
      prUrl: 'https://github.com/acme/widgets/pull/1',
      todoId,
      trackId,
      repoOwner: 'acme',
      repoName: 'widgets',
      prNumber: 1,
      prTitle: 'feat: thing',
    });
    expect(monitor.state).toBe('unknown');
    expect(monitor.checkStatus).toBe('none');
    expect(monitor.monitoring).toBe(true);
    expect(monitor.prTitle).toBe('feat: thing');

    const fetched = repo.findByUrl('https://github.com/acme/widgets/pull/1');
    expect(fetched?.todoId).toBe(todoId);
  });

  it('upserts on re-register without dropping history', () => {
    const { trackId, todoId } = seedTrackAndTodo();
    const repo = createPrMonitorRepository();

    repo.register({
      prUrl: 'https://github.com/acme/widgets/pull/2',
      todoId,
      trackId,
      repoOwner: 'acme',
      repoName: 'widgets',
      prNumber: 2,
    });
    const updated = repo.applyPoll('https://github.com/acme/widgets/pull/2', {
      state: 'open',
      checkStatus: 'failing',
      failingChecks: [{ name: 'tests' }],
      unresolvedComments: [],
      prTitle: 'after poll',
      changed: true,
      stopMonitoring: false,
    });
    expect(updated?.checkStatus).toBe('failing');
    expect(updated?.needsAttentionSince).toBeDefined();

    // Re-register (e.g. todo updated) should preserve the existing state but
    // reset monitoring=1 in case it was paused.
    repo.pauseMonitoring('https://github.com/acme/widgets/pull/2');
    repo.register({
      prUrl: 'https://github.com/acme/widgets/pull/2',
      todoId,
      trackId,
      repoOwner: 'acme',
      repoName: 'widgets',
      prNumber: 2,
    });
    const afterReregister = repo.findByUrl('https://github.com/acme/widgets/pull/2')!;
    expect(afterReregister.monitoring).toBe(true);
    expect(afterReregister.checkStatus).toBe('failing');
    expect(afterReregister.prTitle).toBe('after poll'); // preserved (COALESCE)
  });

  it('findDueForPolling honors the cooldown cutoff and ordering', () => {
    const { trackId, todoId } = seedTrackAndTodo();
    const repo = createPrMonitorRepository();

    repo.register({ prUrl: 'https://github.com/x/y/pull/1', todoId, trackId, repoOwner: 'x', repoName: 'y', prNumber: 1 });
    repo.register({ prUrl: 'https://github.com/x/y/pull/2', todoId, trackId, repoOwner: 'x', repoName: 'y', prNumber: 2 });
    repo.applyPoll('https://github.com/x/y/pull/1', {
      state: 'open', checkStatus: 'passing', failingChecks: [], unresolvedComments: [],
      changed: false, stopMonitoring: false,
    });

    // /pull/2 was never polled, /pull/1 was just polled — only #2 is due.
    const due = repo.findDueForPolling(5, new Date(Date.now() - 60_000).toISOString());
    expect(due.map((m) => m.prNumber)).toEqual([2]);
  });

  it('flips monitoring off when a poll reports the PR finished', () => {
    const { trackId, todoId } = seedTrackAndTodo();
    const repo = createPrMonitorRepository();

    repo.register({ prUrl: 'https://github.com/x/y/pull/3', todoId, trackId, repoOwner: 'x', repoName: 'y', prNumber: 3 });
    const result = repo.applyPoll('https://github.com/x/y/pull/3', {
      state: 'merged',
      checkStatus: 'none',
      failingChecks: [],
      unresolvedComments: [],
      changed: true,
      stopMonitoring: true,
    });
    expect(result?.monitoring).toBe(false);
  });
});

describe('ensureSystemPromptTemplates', () => {
  it('inserts the PR build-fix and comment-response templates idempotently', () => {
    ensureSystemPromptTemplates();
    ensureSystemPromptTemplates();
    const db = getDatabase();
    const rows = db.prepare(`SELECT system_kind FROM prompt_templates WHERE system_kind IN ('pr-build-fix', 'pr-comment-response')`).all() as { system_kind: string }[];
    const kinds = rows.map((r) => r.system_kind).sort();
    expect(kinds).toEqual(['pr-build-fix', 'pr-comment-response']);
  });
});
