import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';
import { createPreviewRouter, buildPicksMarkdown, type PickInput, type PreviewRouterDeps } from '@server/preview-routes.js';

function makePick(overrides: Partial<PickInput> = {}): PickInput {
  return {
    selector: '#submit',
    url: '/checkout',
    tag: 'button',
    rect: { x: 10, y: 20, width: 100, height: 40 },
    viewport: { width: 1280, height: 800 },
    ...overrides,
  };
}

describe('buildPicksMarkdown', () => {
  it('renders the header, note, and per-pick sections', () => {
    const pick = makePick({
      source: 'App.tsx:12:3',
      screenshot: '/tmp/shot.png',
      text: 'Submit',
      outerHTML: '<button>Submit</button>',
      parentHTML: '<form><button>Submit</button></form>',
      styles: { color: 'red', display: 'flex' },
    });

    const md = buildPicksMarkdown('http://localhost:5173', [pick], 'Make this bigger');

    expect(md).toContain('# Design Mode picks');
    expect(md).toContain('Preview: http://localhost:5173/checkout (viewport 1280x800)');
    expect(md).toContain('Make this bigger');
    expect(md).toContain('## 1. `#submit`');
    expect(md).toContain('- Page: /checkout');
    expect(md).toContain('- Source: App.tsx:12:3');
    expect(md).toContain('- Screenshot: /tmp/shot.png');
    expect(md).toContain('- Text: "Submit"');
    expect(md).toContain('- Box: 100×40 at (10, 20)');
    expect(md).toContain('color: red;');
    expect(md).toContain('display: flex;');
    expect(md).toContain('<button>Submit</button>');
    expect(md).toContain('<form><button>Submit</button></form>');
  });

  it('omits optional fields and numbers sections across multiple picks', () => {
    const md = buildPicksMarkdown('http://localhost:5173', [makePick(), makePick({ selector: '.card' })]);
    expect(md).not.toContain('- Source:');
    expect(md).not.toContain('- Screenshot:');
    expect(md).not.toContain('- Text:');
    expect(md).toContain('## 1. `#submit`');
    expect(md).toContain('## 2. `.card`');
  });

  it('neutralises backtick fences inside HTML so they cannot break out of the fence', () => {
    const md = buildPicksMarkdown('http://localhost:5173', [makePick({ outerHTML: 'before ``` after' })]);
    expect(md).toContain('before ` ` ` after');
  });
});

describe('preview routes', () => {
  let sessionDir: string;
  let sessionsHome: string;
  let server: Server;
  let base: string;
  let sent: { id: string; text: string }[];

  beforeAll(async () => {
    sessionsHome = mkdtempSync(path.join(os.tmpdir(), 'workshop-preview-test-'));
    process.env.HOME = sessionsHome;
    sessionDir = path.join(sessionsHome, '.workshop', 'sessions', 'session-1', 'design-picks');
    mkdirSync(sessionDir, { recursive: true });

    sent = [];
    const deps: PreviewRouterDeps = {
      sessions: {
        findById: (id: string) => (['session-1', 'session-offline'].includes(id) ? ({ id } as never) : null),
      },
      terminal: {
        sendInput: async (id: string, text: string) => {
          sent.push({ id, text });
          return id !== 'session-offline';
        },
      },
    };

    const app = express();
    app.use(express.json());
    app.use('/api', createPreviewRouter(deps));
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}/api`;
  });

  afterAll(() => {
    server.close();
    rmSync(sessionsHome, { recursive: true, force: true });
  });

  it('reports screenshots unavailable when no sidecar answers', async () => {
    const res = await fetch(`${base}/preview/status`);
    const body = await res.json();
    expect(body).toEqual({ port: body.port, screenshots: false });
  });

  it('404s send for an unknown session', async () => {
    const res = await fetch(`${base}/sessions/nope/preview/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'http://x', picks: [makePick()] }),
    });
    expect(res.status).toBe(404);
  });

  it('400s send with no picks', async () => {
    const res = await fetch(`${base}/sessions/session-1/preview/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'http://x', picks: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a screenshot path outside the session design-picks dir', async () => {
    const outside = path.join(sessionsHome, 'outside.png');
    writeFileSync(outside, 'not-a-real-png');
    const res = await fetch(`${base}/sessions/session-1/preview/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'http://x', picks: [makePick({ screenshot: outside })] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('outside session directory');
  });

  it('accepts a screenshot path inside the session design-picks dir, writes markdown, and sends input', async () => {
    const inside = path.join(sessionDir, 'shot.png');
    writeFileSync(inside, 'not-a-real-png');
    const res = await fetch(`${base}/sessions/session-1/preview/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'http://x', note: 'fix it', picks: [makePick({ screenshot: inside })] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.file).toContain(sessionDir);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('fix it');
    expect(sent[0].text).toContain(body.file);
  });

  it('409s when the session is not running', async () => {
    const res = await fetch(`${base}/sessions/session-offline/preview/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'http://x', picks: [makePick()] }),
    });
    expect(res.status).toBe(409);
  });

  it('503s shot when screenshots are disabled', async () => {
    process.env.WORKSHOP_SCREENSHOT_URL = '';
    const res = await fetch(`${base}/sessions/session-1/preview/shot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'http://x', url: '/', selector: '#a', width: 200, height: 200 }),
    });
    expect(res.status).toBe(503);
    delete process.env.WORKSHOP_SCREENSHOT_URL;
  });
});
