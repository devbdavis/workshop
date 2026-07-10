import { describe, it, expect } from 'vitest';
import { groupSessionsByTrack } from '../../src/ui/session-overview/group-sessions';
import type { Session, Track } from '../../src/foundation/types';

function session(overrides: Partial<Session>): Session {
  return {
    id: 's1' as Session['id'],
    trackId: 't1' as Session['trackId'],
    tmuxSession: 'tmux',
    state: 'active',
    provider: 'claude',
    background: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Session;
}

function track(id: string): Track {
  return {
    id: id as Track['id'],
    name: id,
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as Track;
}

describe('groupSessionsByTrack', () => {
  it('omits background and dead sessions, and tracks with nothing visible', () => {
    const sessions = [
      session({ id: 'bg' as Session['id'], trackId: 't1' as Session['trackId'], background: true }),
      session({ id: 'dead' as Session['id'], trackId: 't1' as Session['trackId'], state: 'dead' }),
      session({ id: 'alive' as Session['id'], trackId: 't1' as Session['trackId'] }),
    ];
    const groups = groupSessionsByTrack(sessions, [track('t1'), track('t2')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].track.id).toBe('t1');
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['alive']);
  });

  it('omits tracks the profile has hidden', () => {
    const sessions = [
      session({ id: 'a' as Session['id'], trackId: 't1' as Session['trackId'] }),
      session({ id: 'b' as Session['id'], trackId: 't2' as Session['trackId'] }),
    ];
    const hidden = { ...track('t1'), hidden: true };
    const groups = groupSessionsByTrack(sessions, [hidden, track('t2')]);
    expect(groups.map((g) => g.track.id)).toEqual(['t2']);
  });

  it('sorts attention-needing sessions first, then by most recent activity', () => {
    const sessions = [
      session({ id: 'stale' as Session['id'], trackId: 't1' as Session['trackId'], lastActivityAt: '2026-01-01T00:00:00.000Z' }),
      session({ id: 'attention' as Session['id'], trackId: 't1' as Session['trackId'], lastActivityAt: '2026-01-01T00:00:00.000Z', attentionSince: '2026-01-02T00:00:00.000Z' }),
      session({ id: 'recent' as Session['id'], trackId: 't1' as Session['trackId'], lastActivityAt: '2026-01-03T00:00:00.000Z' }),
    ];
    const groups = groupSessionsByTrack(sessions, [track('t1')]);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['attention', 'recent', 'stale']);
  });
});
