import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.WORKSHOP_AUTH_TOKEN = 'test-token-for-dev-router';

vi.mock('@infrastructure/dev-server/dev-server.js', () => ({
  ensureDevServer: vi.fn(),
  stopDevServer: vi.fn(),
}));

import { ensureDevServer } from '@infrastructure/dev-server/dev-server.js';
import { createDevServerRouter } from '@server/dev-server-router.js';
import { signDevTicket } from '@server/dev-host.js';
import type { SessionRepository } from '@domain/session/repository.js';
import type { TrackRepository } from '@domain/track/repository.js';

const SID = 'abcdef012345';
const HOST = `app-${SID}.dev.test`;
const ensure = vi.mocked(ensureDevServer);

let devCommand: string | undefined = 'npm run dev';
const sessions = {
  findAll: () => [
    { id: `${SID.slice(0, 8)}-${SID.slice(8)}-0000-0000-000000000000`, trackId: 't1', workingDirectory: '/w' },
  ],
} as unknown as SessionRepository;
const tracks = { findById: () => ({ id: 't1', devCommand }) } as unknown as TrackRepository;

let server: http.Server;
let upstream: http.Server;
let base: string;
let seen: http.IncomingMessage | null = null;

function get(
  p: string,
  headers: Record<string, string> = {},
  host = HOST,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(base + p, { headers: { host, ...headers } }, (res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      })
      .on('error', reject);
  });
}

const cookie = (): Record<string, string> => ({ cookie: `workshop_dev=${signDevTicket(SID, 60)}` });

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    seen = req;
    res.end('upstream');
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  const app = express();
  app.use(createDevServerRouter({ domain: 'dev.test', sessions, tracks }).middleware);
  app.use((_req, res) => res.status(200).send('workshop'));
  server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  upstream.close();
});
beforeEach(() => {
  ensure.mockReset();
  devCommand = 'npm run dev';
  seen = null;
});

describe('dev server router', () => {
  it('passes non-dev hosts through', async () => {
    expect((await get('/', {}, 'workshop.example')).body).toBe('workshop');
  });

  it('rejects requests without a cookie and starts nothing', async () => {
    expect((await get('/')).status).toBe(401);
    expect(ensure).not.toHaveBeenCalled();
  });

  it('exchanges a valid ticket for a cookie', async () => {
    const res = await get(`/__workshop/auth?t=${signDevTicket(SID, 60)}`);
    expect(res.status).toBe(302);
    expect(res.headers['set-cookie']?.[0]).toMatch(/^workshop_dev=.*HttpOnly.*SameSite=Lax/);
    expect((await get('/__workshop/auth?t=bad')).status).toBe(401);
  });

  it('404s for an unknown session or missing devCommand', async () => {
    const other = `x-${'0'.repeat(12)}.dev.test`;
    expect((await get('/', { cookie: `workshop_dev=${signDevTicket('0'.repeat(12), 60)}` }, other)).status).toBe(404);
    devCommand = '';
    const res = await get('/', cookie());
    expect(res.status).toBe(404);
    expect(res.body).toContain('No dev command set for this track');
  });

  it('shows a refreshing page while starting', async () => {
    ensure.mockResolvedValue({ state: 'starting' });
    const res = await get('/', { ...cookie(), accept: 'text/html' });
    expect(res.status).toBe(503);
    expect(res.body).toContain('http-equiv="refresh"');
    expect((await get('/api/x', cookie())).headers['content-type']).toContain('text/plain');
  });

  it('shows the escaped log when exited', async () => {
    ensure.mockResolvedValue({ state: 'exited', code: 1, logTail: '<script>x</script>' });
    const res = await get('/', cookie());
    expect(res.status).toBe(502);
    expect(res.body).toContain('&lt;script&gt;');
    expect(res.body).toContain('/__workshop/retry');
  });

  it('proxies running servers, including /api, without Workshop credentials', async () => {
    ensure.mockResolvedValue({ state: 'running', port: (upstream.address() as AddressInfo).port });
    const res = await get(`/api/x?token=${process.env.WORKSHOP_AUTH_TOKEN}&keep=1`, {
      cookie: `${cookie().cookie}; workshop_token=zzz; app=1`,
      'x-forwarded-host': 'evil',
    });
    expect(res.body).toBe('upstream');
    expect(seen?.url).toBe('/api/x?keep=1');
    expect(seen?.headers.cookie).toBe('app=1');
    expect(seen?.headers.host).toMatch(/^127\.0\.0\.1:/);
    expect(seen?.headers['x-forwarded-host']).toBe(HOST);
  });

  it("passes an app's own ?token= through", async () => {
    ensure.mockResolvedValue({ state: 'running', port: (upstream.address() as AddressInfo).port });
    await get('/x?token=abc&a=1', cookie());
    expect(seen?.url).toBe('/x?token=abc&a=1');
  });

  it('answers a // path with a 4xx and keeps serving', async () => {
    const res = await get('//');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect((await get('/', {}, 'workshop.example')).body).toBe('workshop');
  });
});
