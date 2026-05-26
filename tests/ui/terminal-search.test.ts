/**
 * @vitest-environment jsdom
 *
 * Integration test for the terminal search wiring.  Spins up xterm.js with
 * the SearchAddon under jsdom, writes a buffer of mock session history,
 * and verifies that findNext drives the result-change subscription with
 * the right counts.  Catches the class of bugs where the addon loads but
 * findNext silently returns no matches due to options misconfiguration,
 * decoration-flag gating on onDidChangeResults, or buffer-state timing.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { createSearchSession } from '../../src/ui/terminal-panel/terminal-search';

beforeAll(() => {
  // xterm.js's open() expects a ResizeObserver and window.matchMedia —
  // jsdom ships neither.  Stub them just enough to let Terminal initialise.
  const g = globalThis as { ResizeObserver?: unknown };
  if (typeof g.ResizeObserver === 'undefined') {
    g.ResizeObserver = class {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    };
  }
  const w = window as Window & { matchMedia?: (q: string) => MediaQueryList };
  if (typeof w.matchMedia !== 'function') {
    w.matchMedia = (q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  }
});

function writeAndFlush(term: Terminal, content: string): Promise<void> {
  return new Promise((resolve) => term.write(content, () => resolve()));
}

describe('terminal-search', () => {
  it('finds matches and reports counts via onResultChange', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    // Production scrollback Terminal sets allowProposedApi: true so the
    // SearchAddon can register match decorations; mirror that here so the
    // test catches the case where production drops that flag.
    const term = new Terminal({ cols: 80, rows: 24, scrollback: 5000, allowProposedApi: true });
    term.open(container);

    const session = createSearchSession(term);

    const results: { resultIndex: number; resultCount: number }[] = [];
    session.onResultChange((info) => results.push(info));

    const history = [
      'workshop dev terminal session',
      'second line, no keyword here',
      'third line mentions workshop again',
      'fourth, fifth, sixth lines without it',
      'last line — workshop one more time',
    ].join('\r\n') + '\r\n';

    await writeAndFlush(term, history);

    session.findNext('workshop');
    // Let the addon's debounced highlighter run.
    await new Promise((r) => setTimeout(r, 50));

    expect(results.length).toBeGreaterThan(0);
    const last = results[results.length - 1];
    expect(last.resultCount).toBe(3);
    expect(last.resultIndex).toBeGreaterThanOrEqual(0);

    session.dispose();
    term.dispose();
  });

  it('reports zero matches for an unknown query', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const term = new Terminal({ cols: 80, rows: 24, scrollback: 5000, allowProposedApi: true });
    term.open(container);

    const session = createSearchSession(term);
    let last: { resultIndex: number; resultCount: number } | null = null;
    session.onResultChange((info) => { last = info; });

    await writeAndFlush(term, 'just some boring content\r\nnothing interesting here\r\n');

    session.findNext('zzzzz-no-such-term');
    await new Promise((r) => setTimeout(r, 50));

    expect(last).not.toBeNull();
    expect(last!.resultCount).toBe(0);

    session.dispose();
    term.dispose();
  });

  it('finds plain text through ANSI-escape-laden Claude-style output', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const term = new Terminal({ cols: 120, rows: 30, scrollback: 5000, allowProposedApi: true });
    term.open(container);

    const session = createSearchSession(term);
    let last: { resultIndex: number; resultCount: number } | null = null;
    session.onResultChange((info) => { last = info; });

    // Real Claude Code output has lots of SGR sequences around plain text.
    // Make sure the addon still matches the underlying plain text.
    const styled =
      '\x1b[38;5;231m**Ability to Search Session History**\x1b[39m\r\n' +
      '\x1b[38;5;231mLooking for a keyword while scrolling is hard\x1b[39m\r\n' +
      '\x1b[38;5;246m  ⎿ ·\x1b[39m0.16.0\r\n' +
      '\x1b[38;5;114m⏺\x1b[39m \x1b[1mBash\x1b[0m(npm view @xterm/addon-search version)\r\n' +
      '  ⎿  \x1b[1m1\x1b[0m pattern, read \x1b[1m3\x1b[0m files\r\n';
    await writeAndFlush(term, styled);

    session.findNext('addon-search');
    await new Promise((r) => setTimeout(r, 50));
    expect(last?.resultCount).toBe(1);

    session.findNext('Ability');
    await new Promise((r) => setTimeout(r, 50));
    expect(last?.resultCount).toBe(1);

    session.dispose();
    term.dispose();
  });

  it('works on a Terminal configured identically to TerminalPanel scrollback', async () => {
    // Regression for the case where production constructed the scrollback
    // Terminal without `allowProposedApi: true`.  The SearchAddon needs to
    // register match decorations (a proposed API); without the flag every
    // findNext throws inside the addon, the error is swallowed, and the
    // user sees a permanent "No matches" even on text they can see.  Keep
    // this constructor literal in sync with TerminalPanel.tsx.
    const container = document.createElement('div');
    document.body.appendChild(container);
    const term = new Terminal({
      cursorBlink: false,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      scrollback: 50000,
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
        cursor: '#e5e5e5',
        selectionBackground: '#334155',
      },
      allowProposedApi: true,
    });
    term.open(container);

    const session = createSearchSession(term);
    let last: { resultIndex: number; resultCount: number } | null = null;
    session.onResultChange((info) => { last = info; });

    await writeAndFlush(term, 'first command output\r\nsecond line of output\r\n');

    session.findNext('output');
    await new Promise((r) => setTimeout(r, 50));
    // Counter must populate with a real count, not stay null and not be 0.
    expect(last).not.toBeNull();
    expect(last!.resultCount).toBe(2);

    session.dispose();
    term.dispose();
  });

  it('matches words rendered at the very end of the buffer (near cursor)', async () => {
    // Regression for the case where findNext starts from the current cursor
    // position; words on the line with the cursor should still match.
    const container = document.createElement('div');
    document.body.appendChild(container);
    const term = new Terminal({ cols: 80, rows: 24, scrollback: 5000, allowProposedApi: true });
    term.open(container);

    const session = createSearchSession(term);
    let last: { resultIndex: number; resultCount: number } | null = null;
    session.onResultChange((info) => { last = info; });

    await writeAndFlush(term, 'older content here\r\n'.repeat(50) + 'sentinel-keyword-here');

    session.findNext('sentinel-keyword-here');
    await new Promise((r) => setTimeout(r, 50));
    expect(last?.resultCount).toBe(1);

    session.dispose();
    term.dispose();
  });
});
