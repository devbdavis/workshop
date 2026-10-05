import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDatabase, resetDatabase } from '@infrastructure/persistence/database';
import { createDiffCommentRepository } from '@infrastructure/persistence/diff-comment-repository';
import { createTrackRepository } from '@infrastructure/persistence/track-repository';
import { createSessionRepository } from '@infrastructure/persistence/session-repository';
import type { SessionId, TrackId } from '@foundation/types';

let workDir: string;
let previousDbPath: string | undefined;
let sessionId: SessionId;

beforeAll(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), 'workshop-diff-comment-test-'));
  previousDbPath = process.env.WORKSHOP_DB_PATH;
  process.env.WORKSHOP_DB_PATH = path.join(workDir, 'workshop.db');

  const track = createTrackRepository().create({ name: 'Test Track', status: 'active' });
  const session = createSessionRepository().create({
    trackId: track.id as TrackId,
    tmuxSession: 'diff-comment-test',
    state: 'active',
  });
  sessionId = session.id;
});

afterAll(() => {
  resetDatabase();
  if (previousDbPath !== undefined) process.env.WORKSHOP_DB_PATH = previousDbPath;
  else delete process.env.WORKSHOP_DB_PATH;
  rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDatabase();
  db.exec('DELETE FROM diff_comments');
});

describe('DiffCommentRepository', () => {
  it('creates a comment and reads it back', () => {
    const repo = createDiffCommentRepository();
    const comment = repo.create({
      sessionId,
      file: 'src/a.ts',
      line: 10,
      lineText: 'const x = 1;',
      body: 'why not const y',
      codeContext: '@@ -1,1 +1,1 @@\n+const x = 1;',
    });
    expect(comment.status).toBe('open');
    expect(comment.anchored).toBe(true);
    expect(comment.side).toBe('RIGHT');
    expect(repo.findById(comment.id)?.body).toBe('why not const y');
    expect(repo.findBySession(sessionId)).toHaveLength(1);
  });

  it('applies partial patches without touching omitted fields', () => {
    const repo = createDiffCommentRepository();
    const comment = repo.create({ sessionId, file: 'src/a.ts', line: 10, lineText: 'x', body: 'note' });
    const patched = repo.update(comment.id, { line: 12, anchored: false });
    expect(patched?.line).toBe(12);
    expect(patched?.anchored).toBe(false);
    expect(patched?.body).toBe('note');
    expect(patched?.status).toBe('open');

    const resolved = repo.update(comment.id, { status: 'resolved' });
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.line).toBe(12);
  });

  it('deletes a comment', () => {
    const repo = createDiffCommentRepository();
    const comment = repo.create({ sessionId, file: 'src/a.ts', line: 1, lineText: 'x', body: 'note' });
    expect(repo.delete(comment.id)).toBe(true);
    expect(repo.findById(comment.id)).toBeNull();
  });

  it('cascades delete when the session is removed', () => {
    const repo = createDiffCommentRepository();
    repo.create({ sessionId, file: 'src/a.ts', line: 1, lineText: 'x', body: 'note' });
    const db = getDatabase();
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    expect(repo.findBySession(sessionId)).toHaveLength(0);
  });
});
