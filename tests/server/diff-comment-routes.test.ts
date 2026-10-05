import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createDiffCommentRouter, buildDiffCommentsPrompt, type DiffCommentRouterDeps } from '@server/diff-comment-routes.js';
import type { DiffCommentRepository } from '@domain/diff-comment/repository';
import type { DiffComment, DiffCommentId, SessionId } from '@foundation/types';

const execFile = promisify(execFileCb);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout;
}

/** In-memory stand-in for the sqlite-backed repository — route tests don't need the real DB/FK. */
function createFakeCommentRepository(): DiffCommentRepository {
  const rows = new Map<string, DiffComment>();
  let seq = 0;
  return {
    findBySession(sessionId) {
      return [...rows.values()].filter((c) => c.sessionId === sessionId);
    },
    findById(id) {
      return rows.get(id) ?? null;
    },
    create(input) {
      const id = `comment-${seq++}` as DiffCommentId;
      const comment: DiffComment = {
        id,
        sessionId: input.sessionId,
        file: input.file,
        line: input.line,
        side: 'RIGHT',
        lineText: input.lineText,
        body: input.body,
        codeContext: input.codeContext,
        anchored: true,
        status: 'open',
        createdAt: new Date().toISOString(),
      };
      rows.set(id, comment);
      return comment;
    },
    update(id, patch) {
      const existing = rows.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch };
      rows.set(id, updated);
      return updated;
    },
    delete(id) {
      return rows.delete(id);
    },
  };
}

describe('diff-comment routes', () => {
  let root: string;
  let server: Server;
  let base: string;
  let comments: DiffCommentRepository;
  let sendInputResult: boolean;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'diff-comment-routes-test-'));
    await git(['init'], root);
    await git(['config', 'user.email', 'test@test.com'], root);
    await git(['config', 'user.name', 'Test User'], root);
    await writeFile(join(root, 'a.ts'), 'alpha\nbravo\ncharlie\ndelta\necho\n');
    await git(['add', '.'], root);
    await git(['commit', '-m', 'Initial commit'], root);

    comments = createFakeCommentRepository();
    sendInputResult = true;

    const deps: DiffCommentRouterDeps = {
      sessions: {
        findById: (id: string) =>
          id === 'session-1' ? ({ id: 'session-1', trackId: 'track-1', worktreeRoot: root } as never) : null,
      } as never,
      tracks: { findReposByTrack: () => [] } as never,
      comments,
      terminal: {
        sendInput: async () => sendInputResult,
      },
    };

    const app = express();
    app.use(express.json());
    app.use('/api', createDiffCommentRouter(deps));
    server = app.listen(0);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}/api`;
  });

  afterAll(async () => {
    server.close();
    await rm(root, { recursive: true, force: true });
  });

  it('rejects a comment on a line outside the current diff', async () => {
    const res = await fetch(`${base}/sessions/session-1/diff-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'a.ts', line: 9999, body: 'nope' }),
    });
    expect(res.status).toBe(400);
  });

  it('follows a commented line as the diff shifts, and flags a removed line as unanchored', async () => {
    // Prepend a line — bravo moves from line 2 to line 3 in the new-side diff.
    await writeFile(join(root, 'a.ts'), 'zulu\nalpha\nbravo\ncharlie\ndelta\necho\n');

    const post = await fetch(`${base}/sessions/session-1/diff-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'a.ts', line: 3, body: 'why bravo?' }),
    });
    expect(post.status).toBe(201);
    const created = (await post.json()) as DiffComment;
    expect(created.lineText).toBe('bravo');
    expect(created.line).toBe(3);

    // Prepend another line — bravo now sits on line 4; the comment should follow it.
    await writeFile(join(root, 'a.ts'), 'yankee\nzulu\nalpha\nbravo\ncharlie\ndelta\necho\n');
    const list1 = await fetch(`${base}/sessions/session-1/diff-comments`);
    const afterShift = (await list1.json()) as DiffComment[];
    const shifted = afterShift.find((c) => c.id === created.id)!;
    expect(shifted.line).toBe(4);
    expect(shifted.anchored).toBe(true);
    expect(shifted.lineText).toBe('bravo');

    // Delete the "bravo" line entirely — the comment can no longer be relocated.
    await writeFile(join(root, 'a.ts'), 'yankee\nzulu\nalpha\ncharlie\ndelta\necho\n');
    const list2 = await fetch(`${base}/sessions/session-1/diff-comments`);
    const afterDelete = (await list2.json()) as DiffComment[];
    const orphaned = afterDelete.find((c) => c.id === created.id)!;
    expect(orphaned.anchored).toBe(false);
    expect(orphaned.lineText).toBe('bravo');

    // Restore bravo and drop this comment so it doesn't bleed into the send test below.
    await writeFile(join(root, 'a.ts'), 'yankee\nzulu\nalpha\nbravo\ncharlie\ndelta\necho\n');
    await fetch(`${base}/diff-comments/${created.id}`, { method: 'DELETE' });
  });

  it('sends only open comments, marks sentAt, and 409s when the session is not running', async () => {
    const postA = await fetch(`${base}/sessions/session-1/diff-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'a.ts', line: 4, body: 'open note about bravo' }),
    });
    const a = (await postA.json()) as DiffComment;

    const postB = await fetch(`${base}/sessions/session-1/diff-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'a.ts', line: 5, body: 'resolved note about charlie' }),
    });
    const b = (await postB.json()) as DiffComment;
    await fetch(`${base}/diff-comments/${b.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });

    sendInputResult = false;
    const failedSend = await fetch(`${base}/sessions/session-1/diff-comments/send`, { method: 'POST' });
    expect(failedSend.status).toBe(409);
    expect(comments.findById(a.id)?.sentAt).toBeUndefined();

    sendInputResult = true;
    const send = await fetch(`${base}/sessions/session-1/diff-comments/send`, { method: 'POST' });
    expect(send.status).toBe(200);
    const body = (await send.json()) as { sent: number };
    expect(body.sent).toBe(1);
    expect(comments.findById(a.id)?.sentAt).toBeTruthy();
    expect(comments.findById(b.id)?.sentAt).toBeUndefined();
  });

  it('builds a prompt that includes open comments only', () => {
    const open: DiffComment = {
      id: 'c1' as DiffCommentId,
      sessionId: 'session-1' as SessionId,
      file: 'a.ts',
      line: 4,
      side: 'RIGHT',
      lineText: 'bravo',
      body: 'open note',
      anchored: true,
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    const outdated: DiffComment = { ...open, id: 'c2' as DiffCommentId, anchored: false, body: 'outdated note', sentAt: '2024-01-01T00:00:00.000Z' };
    const prompt = buildDiffCommentsPrompt([open, outdated]);
    expect(prompt).toContain('open note');
    expect(prompt).toContain('outdated note');
    expect(prompt).toContain('still open from a previous pass');
    expect(prompt).toContain('a.ts:4');
  });
});
