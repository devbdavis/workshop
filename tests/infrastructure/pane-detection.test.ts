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

  it('returns true when a bare prompt marker is present', () => {
    expect(isSessionIdle(session, ['some output', '❯'])).toBe(true);
  });

  it('returns true when the composer holds an unsubmitted draft', () => {
    // A ❯ prompt with typed-but-not-sent text means Claude is done and waiting
    // for the user to hit enter — that's idle, not working, and not red.
    expect(isSessionIdle(session, ['some prior output', '❯ mark the todo ready for review'])).toBe(true);
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
});

describe('isSessionNeedsInput (preCapture)', () => {
  const session = makeSession();

  it('returns true for y/n confirmation prompt', () => {
    expect(isSessionNeedsInput(session, ['Delete all files? [y/n]'])).toBe(true);
  });

  it('returns true for a raw question line without a composer prompt', () => {
    expect(isSessionNeedsInput(session, ['Should I proceed with the rename?'])).toBe(true);
  });

  it('returns true for the Claude permission dialog', () => {
    // Claude Code renders "Do you want to…" with numbered ❯ options below.
    const lines = [
      'Do you want to make this edit to pane-detection.ts?',
      '❯ 1. Yes',
      '  2. No, and tell Claude what to do differently',
    ];
    expect(isSessionNeedsInput(session, lines)).toBe(true);
  });

  it('still detects a permission dialog below a markdown blockquote line', () => {
    // A `> quoted` scrollback line must NOT count as the composer prompt and
    // suppress a real block sitting below it.
    const lines = [
      "I'll apply this change:",
      '> const x = 1',
      'Do you want to make this edit to file.ts?',
      '❯ 1. Yes',
      '  2. No',
    ];
    expect(isSessionNeedsInput(session, lines)).toBe(true);
  });

  it('still detects a permission dialog while a background agent is running', () => {
    // A permission dialog can appear on the main thread while a sub-Agent runs.
    // "N local agent still running" must NOT suppress the RED prompt.
    const lines = [
      'Do you want to run this command?',
      '❯ 1. Yes',
      '  2. No',
      '1 local agent still running · ↓ to manage',
    ];
    expect(isSessionNeedsInput(session, lines)).toBe(true);
  });

  it('returns false when the composer holds a draft (NOT a block)', () => {
    // The whole point: typed-but-unsubmitted text is a draft, not Claude
    // waiting on the user. Must not flip the orb red.
    expect(isSessionNeedsInput(session, ['some prior output', '❯ implement the foo feature'])).toBe(false);
  });

  it('returns false for placeholder/sample text in the composer', () => {
    expect(isSessionNeedsInput(session, ['recap: fixed the thing', '❯ Try "edit <filepath>"'])).toBe(false);
  });

  it('returns false while Claude is working even with queued composer text', () => {
    // User submitted text while a background agent was running; Claude hasn't
    // read it yet. Active-work indicator must win — this is working, not red.
    const lines = [
      'Crunching… (esc to interrupt)',
      '❯ mark the todo ready for review',
    ];
    expect(isSessionNeedsInput(session, lines)).toBe(false);
  });

  it('returns false for a bare ❯ prompt with no typed text', () => {
    expect(isSessionNeedsInput(session, ['some prior output', '❯'])).toBe(false);
  });

  it('returns false when at a composer prompt, even if scroll history has ?', () => {
    // User's input text visible in scroll history should not trigger needs-input
    // when the session is already showing the Claude composer prompt.
    const lines = [
      '> is it still in ready state?',
      '',
      'PR #31 is open and in draft state.',
      '❯',
    ];
    expect(isSessionNeedsInput(session, lines)).toBe(false);
  });

  it('returns false when a draft composer sits below a scrollback question', () => {
    const lines = [
      '> is it still in ready state?',
      'PR #31 is open and in draft state.',
      '❯ yes please continue',
    ];
    expect(isSessionNeedsInput(session, lines)).toBe(false);
  });

  it('returns false for empty capture', () => {
    expect(isSessionNeedsInput(session, [])).toBe(false);
  });
});
