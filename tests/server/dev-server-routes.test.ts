import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { Session, Track } from '@foundation/types';
import type { SessionRepository } from '@domain/session/repository';
import type { TrackRepository } from '@domain/track/repository';
import { createDevServerRoutes } from '@server/dev-server-routes.js';
import { devSid } from '@foundation/dev-sid.js';
import { verifyDevTicket } from '@server/dev-host.js';

const SESSION_ID = '12345678-90ab-cdef-1234-567890abcdef';
let track: Partial<Track>;
let session: Partial<Session> | null;

const sessions = { findById: () => session } as unknown as SessionRepository;
const tracks = { findById: () => track } as unknown as TrackRepository;

describe('dev-server routes', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    process.env.WORKSHOP_AUTH_TOKEN = 'test-token';
    const app = express();
    app.use(createDevServerRoutes({ sessions, tracks }));
    await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterAll(() => { server.close(); });
  afterEach(() => { delete process.env.WORKSHOP_DEV_DOMAIN; });

  async function get(headers: Record<string, string> = {}): Promise<{ url: string | null }> {
    const res = await fetch(`${base}/sessions/${SESSION_ID}/dev-server`, { headers });
    return (await res.json()) as { url: string | null };
  }

  function setup(devCommand?: string, deletedAt?: string): void {
    track = { name: 'My Track', devCommand };
    session = { id: SESSION_ID as Session['id'], deletedAt };
  }

  it('is null when the domain env is unset', async () => {
    setup('npm run dev');
    expect((await get()).url).toBeNull();
  });

  it('is null when the track has no devCommand', async () => {
    process.env.WORKSHOP_DEV_DOMAIN = 'dev.example.com';
    setup();
    expect((await get()).url).toBeNull();
  });

  it('is null for a deleted session', async () => {
    process.env.WORKSHOP_DEV_DOMAIN = 'dev.example.com';
    setup('npm run dev', '2026-01-01');
    expect((await get()).url).toBeNull();
  });

  it('returns a signed auth url', async () => {
    process.env.WORKSHOP_DEV_DOMAIN = 'dev.example.com';
    setup('npm run dev');
    const { url } = await get({ 'x-forwarded-proto': 'https, http' });
    const parsed = new URL(url ?? '');
    expect(parsed.protocol).toBe('https:');
    expect(parsed.host).toBe(`my-track-${devSid(SESSION_ID)}.dev.example.com`);
    expect(parsed.pathname).toBe('/__workshop/auth');
    expect(verifyDevTicket(parsed.searchParams.get('t'), devSid(SESSION_ID))).toBe(true);
  });
});
