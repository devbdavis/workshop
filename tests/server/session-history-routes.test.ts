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
  let running = true;
  const sent: unknown[] = [];

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
        readTranscript: async (id: string) => (id === sessionId
          ? [{ id: 'u1', role: 'user', blocks: [{ type: 'text', text: 'hi' }], timestamp: null }, { id: 'u2', role: 'assistant', blocks: [{ type: 'text', text: 'yo' }], timestamp: null }]
          : null),
        stat: async (id: string) => (id === sessionId ? { mtimeMs: 1, size: 2 } : null),
      },
      sessions: {
        findAll: () => [{ id: 'session-1', trackId: 'track-1', worktreeRoot: root } as never],
        findAllDeleted: () => [],
        findById: (id: string) => (id === 'session-1' ? ({ id } as never) : null),
      },
      tracks: {
        findAll: () => [{ id: 'track-1', name: 'My Track' } as never],
        findReposByTrack: () => [],
        findById: (id: string) => (id === 'track-1' ? ({ id: 'track-1', name: 'My Track' } as never) : null),
      },
      terminal: {
        sendInput: async (_id: string, text: string) => { sent.push(text); return running; },
        sendKeys: async (_id: string, keys: string[]) => { sent.push({ keys }); return running; },
        capturePrompt: (id: string) => (running ? (id === 'session-1' ? { question: 'Q', options: [], hasSubmitTab: false, screen: [] } : null) : undefined),
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
    const body = (await res.json()) as { messages: unknown[] };
    expect(body.messages).toHaveLength(2);
  });

  it('tails the transcript when limit is given', async () => {
    const res = await fetch(`${base}/session-history/${sessionId}/transcript?limit=1`);
    const body = (await res.json()) as { messages: unknown[] };
    expect(body.messages).toEqual([{ id: 'u2', role: 'assistant', blocks: [{ type: 'text', text: 'yo' }], timestamp: null }]);
  });

  it('304s the transcript when If-None-Match matches, without re-reading', async () => {
    const first = await fetch(`${base}/session-history/${sessionId}/transcript?limit=5`);
    const etag = first.headers.get('etag') ?? '';
    expect(etag).not.toBe('');
    const again = await fetch(`${base}/session-history/${sessionId}/transcript?limit=5`, { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
    const otherLimit = await fetch(`${base}/session-history/${sessionId}/transcript?limit=1`, { headers: { 'If-None-Match': etag } });
    expect(otherLimit.status).toBe(200);
  });

  describe('POST /sessions/:id/input', () => {
    const post = (id: string, body: unknown) =>
      fetch(`${base}/sessions/${id}/input`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    it('400s on empty, oversize, or non-whitelisted input', async () => {
      expect((await post('session-1', { text: '  ' })).status).toBe(400);
      expect((await post('session-1', { text: 'x'.repeat(20001) })).status).toBe(400);
      expect((await post('session-1', { key: 'Escape' })).status).toBe(400);
      for (const keys of [[], ['a'], ['0'], ['10'], ['C-c'], ['Enter; ls'], 'Enter', [1], Array(11).fill('1')]) {
        expect((await post('session-1', { keys })).status).toBe(400);
      }
    });

    it('404s unknown sessions and 409s when not running', async () => {
      expect((await post('nope', { text: 'hi' })).status).toBe(404);
      running = false;
      expect((await post('session-1', { text: 'hi' })).status).toBe(409);
      running = true;
    });

    it('sends text and whitelisted keys', async () => {
      sent.length = 0;
      expect((await post('session-1', { text: 'hello' })).status).toBe(204);
      expect((await post('session-1', { keys: ['Escape'] })).status).toBe(204);
      expect((await post('session-1', { keys: ['2', 'Right', 'Enter'] })).status).toBe(204);
      expect(sent).toEqual(['hello', { keys: ['Escape'] }, { keys: ['2', 'Right', 'Enter'] }]);
    });
  });

  describe('GET /sessions/:id/prompt', () => {
    it('404s unknown, 409s when not running, else returns the prompt', async () => {
      expect((await fetch(`${base}/sessions/nope/prompt`)).status).toBe(404);
      running = false;
      expect((await fetch(`${base}/sessions/session-1/prompt`)).status).toBe(409);
      running = true;
      const res = await fetch(`${base}/sessions/session-1/prompt`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { prompt: { question: string } }).prompt.question).toBe('Q');
    });
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
