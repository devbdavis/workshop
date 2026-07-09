import { execSync } from 'child_process';
import type { Session } from '@foundation/types';

/** Capture the last N non-empty lines from a tmux pane. */
export function capturePaneLines(tmuxSession: string, count = 20): string[] {
  try {
    const output = execSync(
      `tmux capture-pane -t ${tmuxSession} -p`,
      { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 },
    );
    return output.trimEnd().split('\n').filter(l => l.trim() !== '').slice(-count);
  } catch {
    return [];
  }
}

/** Indicators that a session is not idle: the main thread is working
 *  (spinner/interruptible) OR a sub-Agent is still running after control was
 *  handed back. Used to keep a session with async work from being reaped. */
const ACTIVE_WORK_RE = /Running…|Thinking|esc to interrupt|local agents? still running/i;

/** Indicators that Claude's MAIN thread is actively producing output right now.
 *  Narrower than ACTIVE_WORK_RE on purpose: it deliberately excludes
 *  `local agents? still running` (a permission dialog CAN appear on the main
 *  thread while a background Agent runs — suppressing needs-input there would
 *  lose the RED prompt) and the unanchored word `Thinking` (matches prose like
 *  "here's my thinking"). `esc to interrupt` is the reliable spinner anchor. */
const MAIN_THREAD_BUSY_RE = /Running…|esc to interrupt/i;

/** True if `line` is the Claude composer prompt — a bare `❯`/`>`, a `…❯`, or a
 *  `❯` followed by draft/ghost text the user (or Claude's auto-suggestion) has
 *  placed in the input box. A numbered confirmation option (`❯ 1. Yes`) is NOT
 *  a composer prompt — that's an interactive menu the user must answer. */
function isComposerPrompt(line: string): boolean {
  const t = line.trim();
  if (t === '>' || t.endsWith('❯')) return true; // bare prompt (covers plain `❯`)
  if (/^❯\s*\d+\.\s/.test(t)) return false; // numbered menu option, not a draft
  // ponytail: only numbered menus (Claude Code's shape) are excluded. A
  // non-numbered `❯ Yes, proceed` select (older/other CLIs) would read as a
  // draft and lose RED — add its shape here if a supported CLI renders one.
  return /^❯\s+\S/.test(t); // ❯ with a draft — `>` excluded so scrollback quotes don't match
}

/** Check if the tmux pane shows an idle Claude session: no active-work
 *  indicator, and the composer prompt is visible (bare, or holding an
 *  unsubmitted draft). The Claude TUI renders a status bar below the prompt,
 *  so we scan the last several lines rather than only the very last one. */
export function isSessionIdle(session: Session, preCapture?: string[]): boolean {
  const lines = preCapture ?? capturePaneLines(session.tmuxSession, 8);
  if (lines.length === 0) return false;
  // Active work indicators — scan ALL captured lines, not just the tail, since
  // the TUI may render them above the prompt row (e.g. a 20-line sync capture).
  if (ACTIVE_WORK_RE.test(lines.join(' '))) return false;
  return lines.slice(-8).some(isComposerPrompt);
}

/**
 * Check if the session is genuinely blocked waiting on the user — a real
 * confirmation/question prompt, NOT just text sitting in the composer.
 *
 * Only high-confidence blocking prompts count: y/n confirmations, "press
 * enter", Claude's "Do you want to…" permission dialog, or a trailing-`?`
 * question. Crucially:
 *   - If Claude is actively working, queued composer text is not a block.
 *   - If we're sitting at the composer prompt (bare or with a draft), any
 *     `?` text is scrollback or the user's own draft, not a live prompt.
 */
export function isSessionNeedsInput(session: Session, preCapture?: string[]): boolean {
  const lines = preCapture ?? capturePaneLines(session.tmuxSession, 15);
  if (lines.length === 0) return false;
  const tail = lines.slice(-15);
  // Main thread actively producing output — composer text is queued input,
  // not a block. (Queued text is also caught by the composer bail below; this
  // guard covers the moment before the draft renders.)
  if (MAIN_THREAD_BUSY_RE.test(tail.join(' '))) return false;
  // Sitting at the composer prompt (bare or draft, but not a numbered menu) —
  // any question text is scrollback or the user's own unsubmitted draft.
  if (tail.slice(-8).some(isComposerPrompt)) return false;
  return tail.some(line => {
    const t = line.trimEnd();
    // y/n confirmation prompts from subprocesses or Claude
    if (/\[y\/n\]|\[Y\/n\]|\[y\/N\]|\(yes\/no\)|\(y\/n\)/i.test(t)) return true;
    // "Press Enter to continue" style prompts
    if (/press\s+enter/i.test(t)) return true;
    // Claude Code permission dialog ("Do you want to make this edit?" etc.)
    if (/Do you want to\b/i.test(t)) return true;
    // Lines ending with ? suggest a question was asked. Skip bare CLI prompt
    // lines (❯ or >) to avoid false positives.
    if (/\?\s*$/.test(t) && !/^[❯>]\s*$/.test(t)) return true;
    return false;
  });
}

/** Check if the session shows Claude is not logged in.
 *  When `preCapture` is provided, skip internal `capturePaneLines()` call. */
export function isSessionLoggedOut(session: Session, preCapture?: string[]): boolean {
  const lines = preCapture ?? capturePaneLines(session.tmuxSession, 10);
  const tail = lines.slice(-10).join(' ');
  return /not logged in|Please run \/login/i.test(tail);
}

/** Check if the CLI process has exited and the pane shows a bare shell.
 *  When `preCapture` is provided, skip internal `capturePaneLines()` call. */
export function isSessionExited(session: Session, preCapture?: string[]): boolean {
  const lines = preCapture ?? capturePaneLines(session.tmuxSession, 5);
  if (lines.length === 0) return false;
  const lastLine = lines[lines.length - 1]?.trim() || '';
  // Bare shell prompts: zsh (➜/%), bash ($)
  return /^[$%]$/.test(lastLine) || /^➜\s/.test(lastLine);
}
