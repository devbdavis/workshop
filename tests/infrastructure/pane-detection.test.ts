import { describe, it, expect } from 'vitest';
import { isSessionIdle } from '@infrastructure/terminal/pane-detection';
import type { Session } from '@foundation/types';

/** Minimal session stub — only tmuxSession matters when preCapture is provided */
function makeSession(tmux = 'ws-test'): Session {
  return {
    id: 'sess-1' as any,
    trackId: 'track-1' as any,
    tmuxSession: tmux,
    state: 'active',
    provider: 'claude',
    background: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('isSessionIdle (preCapture)', () => {
  const session = makeSession();

  it('returns true when prompt marker is present', () => {
    expect(isSessionIdle(session, ['some output', '❯'])).toBe(true);
  });

  it('returns false when Thinking indicator is present despite prompt', () => {
    expect(isSessionIdle(session, ['Thinking...', '❯'])).toBe(false);
  });

  it('returns false when Running… indicator is present despite prompt', () => {
    expect(isSessionIdle(session, ['Running…', '❯'])).toBe(false);
  });

  it('returns false when Thinking indicator is above the 8-line tail window', () => {
    // Simulates a 20-line capture where the indicator scrolled above line -8
    const lines = [
      'Thinking',
      'line2', 'line3', 'line4', 'line5', 'line6', 'line7', 'line8',
      'line9', 'line10', 'line11', 'line12', 'line13',
      '❯',
    ];
    expect(isSessionIdle(session, lines)).toBe(false);
  });

  it('returns false when "esc to interrupt" is present despite prompt', () => {
    expect(isSessionIdle(session, ['esc to interrupt', '❯'])).toBe(false);
  });

  it('returns false when no prompt marker is present', () => {
    expect(isSessionIdle(session, ['some output', 'more output'])).toBe(false);
  });

  it('returns false for empty capture', () => {
    expect(isSessionIdle(session, [])).toBe(false);
  });
});
