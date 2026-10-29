import { describe, it, expect, vi } from 'vitest';
import { createStaleAgentReaper } from '@application/session-cleanup/stale-agent-reaper.js';
import type { Session } from '@foundation/types';

const HOUR = 60 * 60 * 1_000;

function session(id: string, trackId: string, ageHours: number): Session {
  const ts = new Date(Date.now() - ageHours * HOUR).toISOString();
  return {
    id: id as any,
    trackId: trackId as any,
    tmuxSession: `ws-${id}`,
    state: 'active',
    provider: 'claude',
    background: true,
    createdAt: ts,
    updatedAt: ts,
  };
}

function harness(sessions: Session[]) {
  const destroyed: string[] = [];
  const settings = {
    get: (key: string) =>
      key === 'pr_review_track_id' ? 'pr-track' : key === 'linear_ticket_track_id' ? 'linear-track' : null,
    set: vi.fn(),
  };
  const reaper = createStaleAgentReaper({
    sessions: {
      findByTrack: (trackId: string) => sessions.filter((s) => s.trackId === trackId),
    } as any,
    settings,
    terminal: {
      softDeleteSession: async (id: string) => { destroyed.push(id); },
    } as any,
    broadcast: vi.fn(),
  });
  return { reaper, destroyed };
}

describe('createStaleAgentReaper', () => {
  it('terminates sessions older than 48h in both disposable tracks', async () => {
    const { reaper, destroyed } = harness([
      session('old-review', 'pr-track', 49),
      session('old-linear', 'linear-track', 100),
    ]);
    expect(await reaper.reapNow()).toBe(2);
    expect(destroyed).toEqual(['old-review', 'old-linear']);
  });

  it('leaves fresh sessions and sessions on other tracks alone', async () => {
    const { reaper, destroyed } = harness([
      session('fresh', 'pr-track', 2),
      session('old-but-elsewhere', 'user-track', 200),
    ]);
    expect(await reaper.reapNow()).toBe(0);
    expect(destroyed).toEqual([]);
  });

  it('reaps an old session even when a restart resumed it recently', async () => {
    const stale = session('resumed', 'pr-track', 200);
    const { reaper, destroyed } = harness([{ ...stale, updatedAt: new Date().toISOString() }]);
    expect(await reaper.reapNow()).toBe(1);
    expect(destroyed).toEqual(['resumed']);
  });
});
