import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, writeFile, readFile, symlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createWorkspaceRouter, type WorkspaceRouterDeps } from '@server/workspace-routes.js';

const execFile = promisify(execFileCb);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout;
}

describe('workspace routes', () => {
  let root: string;
  let outsideDir: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'workspace-routes-test-'));
    outsideDir = await mkdtemp(join(tmpdir(), 'workspace-routes-outside-'));

    await git(['init'], root);
    await git(['config', 'user.email', 'test@test.com'], root);
    await git(['config', 'user.name', 'Test User'], root);
    await writeFile(join(root, 'README.md'), '# Hello\n');
    await git(['add', '.'], root);
    await git(['commit', '-m', 'Initial commit'], root);

    // A tracked modification and an untracked file for the changes/diff tests.
    await writeFile(join(root, 'README.md'), '# Hello world\n');
    await writeFile(join(root, 'new-file.txt'), 'new\n');
    await symlink(outsideDir, join(root, 'escape-link'));
    await writeFile(join(outsideDir, 'target.txt'), 'outside\n');
    await symlink(join(outsideDir, 'target.txt'), join(root, 'file-link'));

    const deps: WorkspaceRouterDeps = {
      sessions: {
        findById: (id: string) =>
          id === 'session-1' ? ({ id: 'session-1', trackId: 'track-1', worktreeRoot: root } as never) : null,
      },
      tracks: {
        findReposByTrack: () => [],
      },
    } as unknown as WorkspaceRouterDeps;

    const app = express();
    app.use(express.json());
    app.use('/api', createWorkspaceRouter(deps));
    server = app.listen(0);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}/api`;
  });

  afterAll(async () => {
    server.close();
    await rm(root, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  it('404s for an unknown session', async () => {
    const res = await fetch(`${base}/sessions/nope/workspace/tree`);
    expect(res.status).toBe(404);
  });

  it('lists the root tree, dirs first then alpha, hiding .git', async () => {
    const res = await fetch(`${base}/sessions/session-1/workspace/tree`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { root: string; entries: Array<{ name: string; type: string }> };
    expect(body.root).toBe(root);
    const names = body.entries.map((e) => e.name);
    expect(names).not.toContain('.git');
    expect(names).toContain('README.md');
    expect(names).toContain('new-file.txt');
    expect(names).toContain('escape-link');
  });

  it('rejects path traversal', async () => {
    const res = await fetch(`${base}/sessions/session-1/workspace/tree?path=${encodeURIComponent('../')}`);
    expect(res.status).toBe(400);
  });

  it('rejects a symlink that escapes the root', async () => {
    const res = await fetch(`${base}/sessions/session-1/workspace/file?path=${encodeURIComponent('escape-link/x')}`);
    expect(res.status).toBe(400);
  });

  it('refuses to write through a symlink that escapes the root', async () => {
    const res = await fetch(`${base}/sessions/session-1/workspace/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'file-link', content: 'pwned\n' }),
    });
    expect(res.status).toBe(400);
    expect(await readFile(join(outsideDir, 'target.txt'), 'utf8')).toBe('outside\n');
  });

  it('round-trips a file read/write', async () => {
    const read = await fetch(`${base}/sessions/session-1/workspace/file?path=README.md`);
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as { content: string; binary: boolean; tooLarge: boolean };
    expect(readBody.content).toBe('# Hello world\n');
    expect(readBody.binary).toBe(false);
    expect(readBody.tooLarge).toBe(false);

    // Writes to its own file so it doesn't disturb README.md, which the diff
    // tests below still expect to hold its original modification.
    const write = await fetch(`${base}/sessions/session-1/workspace/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'new-file.txt', content: 'new\nextra\n' }),
    });
    expect(write.status).toBe(200);

    const reread = await fetch(`${base}/sessions/session-1/workspace/file?path=new-file.txt`);
    const rereadBody = (await reread.json()) as { content: string };
    expect(rereadBody.content).toBe('new\nextra\n');
  });

  it('creates a new file within an existing directory', async () => {
    const write = await fetch(`${base}/sessions/session-1/workspace/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'created.txt', content: 'hi\n' }),
    });
    expect(write.status).toBe(200);
    const read = await fetch(`${base}/sessions/session-1/workspace/file?path=created.txt`);
    const body = (await read.json()) as { content: string };
    expect(body.content).toBe('hi\n');
  });

  it('lists modified and untracked changes', async () => {
    const res = await fetch(`${base}/sessions/session-1/workspace/changes`);
    expect(res.status).toBe(200);
    const changes = (await res.json()) as Array<{ repo: string; path: string; status: string }>;
    const readme = changes.find((c) => c.path === 'README.md');
    expect(readme?.status).toBe(' M');
    const untracked = changes.find((c) => c.path === 'new-file.txt');
    expect(untracked?.status).toBe('??');
  });

  it('returns a unified diff for a tracked modified file', async () => {
    const res = await fetch(`${base}/sessions/session-1/workspace/diff?path=README.md`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { diff: string };
    expect(body.diff).toContain('-# Hello');
    expect(body.diff).toContain('+# Hello world');
  });

  it('returns a synthetic diff for an untracked file', async () => {
    const res = await fetch(`${base}/sessions/session-1/workspace/diff?path=new-file.txt`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { diff: string };
    expect(body.diff).toContain('+new');
  });
});
