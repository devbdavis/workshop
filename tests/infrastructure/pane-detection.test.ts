import { describe, it, expect } from 'vitest';
import { isSessionIdle, isSessionNeedsInput } from '@infrastructure/terminal/pane-detection';
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

  it('returns false when a local agent is still running despite idle prompt', () => {
    // Claude can hand control back (idle ❯) while an Agent task continues
    // asynchronously — the TUI shows "N local agent(s) still running" near
    // the bottom. Treat that as not-idle so we don't reap the session.
    expect(isSessionIdle(session, ['Some prior output', '❯', '1 local agent still running · ↓ to manage'])).toBe(false);
    expect(isSessionIdle(session, ['❯', '2 local agents still running'])).toBe(false);
  });

  it('returns false when no prompt marker is present', () => {
    expect(isSessionIdle(session, ['some output', 'more output'])).toBe(false);
  });

  it('returns false for empty capture', () => {
    expect(isSessionIdle(session, [])).toBe(false);
  });

  it('returns true when ❯ is followed by a dim ghost suggestion (raw provided)', () => {
    // Claude's TUI renders the tab-to-accept ghost suggestion in dim styling
    // (`\x1b[2m...\x1b[0m`). The stripped text reads `❯ commit this` — which
    // textually looks like user-typed input, but raw ANSI tells the real story:
    // the user is idle and Claude is just suggesting a prompt.
    const text = ['some prior output', '❯ commit this'];
    const raw = ['some prior output', '\x1b[39m❯ \x1b[2mcommit\x1b[0m \x1b[2mthis\x1b[0m'];
    expect(isSessionIdle(session, text, raw)).toBe(true);
  });

  it('returns true for ghost suggestion styled with grey 256-colour fg', () => {
    const text = ['❯ try this prompt'];
    const raw = ['❯ \x1b[38;5;240mtry this prompt\x1b[39m'];
    expect(isSessionIdle(session, text, raw)).toBe(true);
  });
});

describe('isSessionNeedsInput (preCapture)', () => {
  const session = makeSession();

  it('returns true for y/n confirmation prompt', () => {
    expect(isSessionNeedsInput(session, ['Delete all files? [y/n]'])).toBe(true);
  });

  it('returns true for a question line without an idle prompt', () => {
    expect(isSessionNeedsInput(session, ['Should I proceed with the rename?'])).toBe(true);
  });

  it('returns true when Claude prompt has typed but unsubmitted text', () => {
    expect(isSessionNeedsInput(session, ['some prior output', '❯ implement the foo feature'])).toBe(true);
  });

  it('returns false for a bare ❯ prompt with no typed text', () => {
    expect(isSessionNeedsInput(session, ['some prior output', '❯'])).toBe(false);
  });

  it('returns false when terminal is at an idle ❯ prompt, even if scroll history has ?', () => {
    // User's input text visible in scroll history should not trigger needs-input
    // when the session is already showing the idle Claude prompt.
    const lines = [
      '> is it still in ready state?',
      '',
      'PR #31 is open and in draft state.',
      '❯',
    ];
    expect(isSessionNeedsInput(session, lines)).toBe(false);
  });

  it('returns false for empty capture', () => {
    expect(isSessionNeedsInput(session, [])).toBe(false);
  });

  it('returns false when ❯ is followed by a dim ghost suggestion (raw provided)', () => {
    // Without ghost detection, `❯ commit this` looks identical to user-typed
    // text and would flip the orb to needs-input (RED). When raw ANSI is
    // available, the dim styling reveals this as Claude's auto-suggestion.
    const text = ['some prior output', '❯ commit this'];
    const raw = ['some prior output', '\x1b[39m❯ \x1b[2mcommit\x1b[0m \x1b[2mthis\x1b[0m'];
    expect(isSessionNeedsInput(session, text, raw)).toBe(false);
  });

  it('still treats user-typed text after ❯ as needs-input (raw has no dim)', () => {
    const text = ['❯ implement the foo feature'];
    const raw = ['❯ implement the foo feature'];
    expect(isSessionNeedsInput(session, text, raw)).toBe(true);
  });

  it('treats typed-then-ghost (`❯ commit\\x1b[2m this fix`) as needs-input', () => {
    // User typed "commit" and Claude appended a ghost completion. Because
    // the first visible character after ❯ is normal-intensity, this is
    // genuine user input mid-composition.
    const text = ['❯ commit this fix'];
    const raw = ['❯ commit\x1b[2m this fix\x1b[0m'];
    expect(isSessionNeedsInput(session, text, raw)).toBe(true);
  });

  it('falls back to current behavior when raw is not provided', () => {
    // Backward-compatible: old callers pass only stripped text and get the
    // pre-ghost-fix classification. We accept the false positive in this
    // path because no production caller relies on it anymore.
    expect(isSessionNeedsInput(session, ['❯ commit this'])).toBe(true);
  });
});
