import { describe, it, expect, vi } from 'vitest';
import { getActivityState, getIdleDuration, providerColor } from '@ui/office/activity';
import type { Session } from '@foundation/types';

/** Helper to create a minimal session stub */
function makeSession(overrides: Partial<Session & { dying?: boolean }> = {}): Session & { dying?: boolean } {
  return {
    id: 'sess-1' as any,
    trackId: 'track-1' as any,
    tmuxSession: 'ws-test',
    state: 'active',
    provider: 'claude',
    background: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('getActivityState', () => {
  it('returns dying when session.dying is true', () => {
    expect(getActivityState(makeSession({ dying: true }))).toBe('dying');
  });

  it('returns empty when state is dead', () => {
    expect(getActivityState(makeSession({ state: 'dead' }))).toBe('empty');
  });

  it('returns floor-sleeping when state is suspended', () => {
    expect(getActivityState(makeSession({ state: 'suspended' }))).toBe('floor-sleeping');
  });

  it('returns working when no lastActivityAt', () => {
    expect(getActivityState(makeSession({ lastActivityAt: undefined }))).toBe('working');
  });

  it('returns working when lastActivityAt is recent (30s ago)', () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    expect(getActivityState(makeSession({ lastActivityAt: recent }))).toBe('working');
  });

  it('returns sleeping when lastActivityAt is >60s ago', () => {
    const old = new Date(Date.now() - 90_000).toISOString();
    expect(getActivityState(makeSession({ lastActivityAt: old }))).toBe('sleeping');
  });

  it('returns sleeping at exactly 60s boundary', () => {
    // Just over 60s to account for test execution time
    const boundary = new Date(Date.now() - 61_000).toISOString();
    expect(getActivityState(makeSession({ lastActivityAt: boundary }))).toBe('sleeping');
  });
});

describe('getIdleDuration', () => {
  it('returns empty string when no lastActivityAt', () => {
    expect(getIdleDuration(makeSession())).toBe('');
  });

  it('returns seconds for < 60s', () => {
    const s = makeSession({ lastActivityAt: new Date(Date.now() - 45_000).toISOString() });
    expect(getIdleDuration(s)).toBe('45s');
  });

  it('returns minutes for < 60m', () => {
    const s = makeSession({ lastActivityAt: new Date(Date.now() - 5 * 60_000).toISOString() });
    expect(getIdleDuration(s)).toBe('5m');
  });

  it('returns hours for >= 60m', () => {
    const s = makeSession({ lastActivityAt: new Date(Date.now() - 2 * 3600_000).toISOString() });
    expect(getIdleDuration(s)).toBe('2h');
  });
});

describe('providerColor', () => {
  it('returns bg-blue-500 for claude', () => {
    expect(providerColor('claude')).toBe('bg-blue-500');
  });

  it('returns bg-red-500 for codex', () => {
    expect(providerColor('codex')).toBe('bg-red-500');
  });

  it('returns bg-yellow-500 for gemini', () => {
    expect(providerColor('gemini')).toBe('bg-yellow-500');
  });

  it('returns bg-gray-500 for unknown provider', () => {
    expect(providerColor('unknown')).toBe('bg-gray-500');
  });
});
