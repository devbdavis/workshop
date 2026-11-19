import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTodoRouter, type TodoRouterDeps } from '@server/todo-routes.js';

// A real (empty, non-git) directory: the route refuses to hand off into a missing one.
const PREV_CWD = mkdtempSync(path.join(os.tmpdir(), 'handoff-'));

function buildApp(todo: Record<string, unknown>) {
  const created: any[] = [];
  const deps = {
    todos: { findById: () => todo, update: (_: string, d: any) => ({ ...todo, ...d }) },
    tracks: {
      findById: () => ({ id: 'track-1', name: 'T', worktreeMode: true }),
      findReposByTrack: () => [{ path: '/repo' }],
      findPathsByTrack: () => [],
    },
    sessions: {
      findById: (id: string) =>
        id === 'old' || id === 'gone' ? { deletedAt: id === 'gone' ? new Date().toISOString() : undefined, id: 'old', provider: 'claude', claudeResumeId: 'c1', workingDirectory: PREV_CWD, worktreeRoot: '/nonexistent-handoff-root', createdAt: new Date().toISOString() } : null,
    },
    agents: { findById: () => null },
    promptTemplates: { findById: () => null },
    issues: { findByTrack: () => [] },
    settings: { get: () => null },
    vaultReader: { readTrackFiles: () => [] },
    historyScanner: { readTranscript: async () => [{ id: null, role: 'user', timestamp: null, blocks: [{ type: 'text', text: 'please fix login' }] }] },
    terminal: {
      createSession: async (_t: string, opts: any) => {
        created.push(opts);
        return { id: 'new', trackId: 'track-1', tmuxSession: 't', state: 'active' };
      },
    },
  } as unknown as TodoRouterDeps;
  const app = express();
  app.use(express.json());
  app.use(createTodoRouter(deps));
  return { app, created };
}

describe('dispatch handoff', () => {
  let server: Server;
  let base = '';
  let withSession: ReturnType<typeof buildApp>;
  let withoutSession: ReturnType<typeof buildApp>;
  let server2: Server;
  let base2 = '';

  const port = (s: Server): number => {
    const a = s.address();
    return typeof a === 'object' && a ? a.port : 0;
  };

  beforeAll(() => {
    withSession = buildApp({ id: 't1', trackId: 'track-1', title: 'Fix login', status: 'in-progress', sessionId: 'old' });
    withoutSession = buildApp({ id: 't1', trackId: 'track-1', title: 'Fix login', status: 'ready' });
    server = withSession.app.listen(0);
    server2 = withoutSession.app.listen(0);
    base = `http://127.0.0.1:${port(server)}`;
    base2 = `http://127.0.0.1:${port(server2)}`;
  });
  afterAll(() => {
    server.close();
    server2.close();
  });

  const post = (url: string, body: unknown) =>
    fetch(`${url}/todos/t1/dispatch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('400s without a previous session', async () => {
    const res = await post(base2, { handoff: true, provider: 'codex' });
    expect(res.status).toBe(400);
    expect(withoutSession.created).toHaveLength(0);
  });

  it('409s when the previous session was already handed off', async () => {
    const gone = buildApp({ id: 't1', trackId: 'track-1', title: 'Fix login', status: 'in-progress', sessionId: 'gone' });
    const srv = gone.app.listen(0);
    try {
      const res = await post(`http://127.0.0.1:${port(srv)}`, { handoff: true, provider: 'codex' });
      expect(res.status).toBe(409);
      expect(gone.created).toHaveLength(0);
    } finally {
      srv.close();
    }
  });

  it('launches in the previous cwd with the brief and no worktree', async () => {
    const res = await post(base, { handoff: true, provider: 'codex' });
    expect(res.status).toBe(201);
    const opts = withSession.created[0];
    expect(opts.workingDirectory).toBe(PREV_CWD);
    expect(opts.worktreeMode).toBe(false);
    expect(opts.handoffFrom).toEqual({ sessionId: 'old', worktreeRoot: '/nonexistent-handoff-root', workingDirectory: PREV_CWD });
    expect(opts.provider).toBe('codex');
    expect(opts.systemPrompt).toContain('## Handoff');
    expect(opts.systemPrompt).toContain('please fix login');
    expect(opts.initialPrompt).toContain('taking over');
  });
});
