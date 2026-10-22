import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createPrDiffRouter } from '@server/pr-diff-routes.js';

const PR = 'https://github.com/o/r/pull/1';
let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use('/api', createPrDiffRouter({
    todos: { findById: (id) => (id === 't1' ? ({ pullRequests: [{ url: PR }] } as never) : null) },
    forge: { fetchPrDiff: async (url) => `diff for ${url}` },
  }));
  server = await new Promise<Server>((r) => { const s = app.listen(0, () => r(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/todos`;
});
afterAll(() => { server.close(); });

describe('pr-diff routes', () => {
  it('returns the diff for a linked PR', async () => {
    const res = await fetch(`${base}/t1/pr-diff?prUrl=${encodeURIComponent(PR)}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ diff: `diff for ${PR}` });
  });
  it('404s for a URL not on the todo', async () => {
    expect((await fetch(`${base}/t1/pr-diff?prUrl=https://evil/x`)).status).toBe(404);
    expect((await fetch(`${base}/nope/pr-diff?prUrl=${encodeURIComponent(PR)}`)).status).toBe(404);
  });
  it('400s without prUrl', async () => {
    expect((await fetch(`${base}/t1/pr-diff`)).status).toBe(400);
  });
});
