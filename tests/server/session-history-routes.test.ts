import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

import { createSessionHistoryRouter, type SessionHistoryRouterDeps } from '@server/session-history-routes.js';
import type { SessionHistoryEntry } from '@infrastructure/usage/session-history.js';

describe('session history routes', () => {
  let root: string;
  let server: Server;
  let base: string;
  const sessionId = randomUUID();
  let resumeCwd = '';

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'session-history-routes-test-'));
    resumeCwd = root;

    const entry: SessionHistoryEntry = {
      sessionId,
      filePath: '/dev/null',
      cwd: root,
      gitBranch: 'main',
      model: 'claude-opus-5-5',
      title: 'Test session',
      preview: 'hello',
      firstAt: '2026-07-01T00:00:00.000Z',
      lastAt: '2026-07-01T00:00:01.000Z',
      messageCount: 2,
    };

    const deps: SessionHistoryRouterDeps = {
      scanner: {
        list: async () => [entry],
        readTranscript: async (id: string) => (id === sessionId ? [{ role: 'user', text: 'hi', timestamp: null }] : null),
      },
      sessions: {
        findAll: () => [{ id: 'session-1', trackId: 'track-1', worktreeRoot: root } as never],
        findAllDeleted: () => [],
      },
      tracks: {
        findAll: () => [{ id: 'track-1', name: 'My Track' } as never],
        findReposByTrack: () => [],
        findById: (id: string) => (id === 'track-1' ? ({ id: 'track-1', name: 'My Track' } as never) : null),
      },
      terminal: {
        createSession: async () => {
          throw new Error('createSession should not be called when cwd is missing');
        },
      },
    } as unknown as SessionHistoryRouterDeps;

    const app = express();
    app.use(express.json());
    app.use('/api', createSessionHistoryRouter(deps));
    server = app.listen(0);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}/api`;
  });

  afterAll(async () => {
    server.close();
    await rm(root, { recursive: true, force: true });
  });

  it('maps a session to its track via worktreeRoot prefix match', async () => {
    const res = await fetch(`${base}/session-history`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ sessionId: string; trackId: string; trackName: string; cwdExists: boolean }>;
    expect(body).toHaveLength(1);
    expect(body[0].trackId).toBe('track-1');
    expect(body[0].trackName).toBe('My Track');
    expect(body[0].cwdExists).toBe(true);
    expect(body[0]).not.toHaveProperty('filePath');
  });

  it('400s on an invalid session ID for the transcript route', async () => {
    const res = await fetch(`${base}/session-history/not-a-uuid/transcript`);
    expect(res.status).toBe(400);
  });

  it('404s on an unknown session ID for the transcript route', async () => {
    const res = await fetch(`${base}/session-history/${randomUUID()}/transcript`);
    expect(res.status).toBe(404);
  });

  it('returns the transcript for a known session', async () => {
    const res = await fetch(`${base}/session-history/${sessionId}/transcript`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: Array<{ role: string; text: string }> };
    expect(body.messages).toEqual([{ role: 'user', text: 'hi', timestamp: null }]);
  });

  it('404s resume for an unknown track', async () => {
    const res = await fetch(`${base}/session-history/${sessionId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId: 'nope' }),
    });
    expect(res.status).toBe(404);
  });

  it('400s resume when the original cwd no longer exists', async () => {
    await rm(resumeCwd, { recursive: true, force: true });
    const res = await fetch(`${base}/session-history/${sessionId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId: 'track-1' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Original directory no longer exists');
  });
});
