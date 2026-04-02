import { execSync } from 'child_process';
import type { Session } from '@foundation/types';

/** Capture the last N non-empty lines from a tmux pane */
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

/** Check if the tmux pane shows an idle CLI prompt (❯ or > at end).
 *  The Claude TUI renders a status bar *below* the ❯ prompt line, so
 *  we scan the last several lines rather than just the very last one.
 *  We also verify there's no active work indicator (spinner/thinking).
 *
 *  When `preCapture` is provided, those lines are used directly instead
 *  of calling `capturePaneLines()` internally — avoids duplicate tmux capture. */
export function isSessionIdle(session: Session, preCapture?: string[]): boolean {
  const lines = preCapture ?? capturePaneLines(session.tmuxSession, 8);
  if (lines.length === 0) return false;
  // Active work indicators — scan ALL captured lines, not just the tail.
  // The TUI may render indicators above the prompt row; slicing to 8 would
  // miss them if the capture window is larger (e.g. the 20-line sync capture).
  const allContent = lines.join(' ');
  if (/Running…|Thinking|thinking|esc to interrupt/i.test(allContent)) return false;
  // Check if any of the last 8 lines contains the CLI prompt indicator.
  // The prompt line is typically just `❯` or `❯ ` (possibly with spaces).
  return lines.slice(-8).some(line => {
    const t = line.trim();
    return t === '❯' || t === '>' || t.endsWith('❯');
  });
}

/**
 * Check if the terminal session is waiting for user input mid-task.
 * Looks for interactive prompt patterns: y/n confirmations, question lines,
 * "press enter" prompts. Takes priority over isSessionIdle in the status chain.
 * When `preCapture` is provided, skip internal capturePaneLines() call.
 */
export function isSessionNeedsInput(session: Session, preCapture?: string[]): boolean {
  const lines = preCapture ?? capturePaneLines(session.tmuxSession, 15);
  if (lines.length === 0) return false;
  return lines.slice(-15).some(line => {
    const t = line.trimEnd();
    // y/n confirmation prompts from subprocesses or Claude
    if (/\[y\/n\]|\[Y\/n\]|\[y\/N\]|\(yes\/no\)|\(y\/n\)/i.test(t)) return true;
    // "Press Enter to continue" style prompts
    if (/press\s+enter/i.test(t)) return true;
    // Lines ending with ? suggest Claude or a subprocess asked a question
    // Skip bare CLI prompt lines (❯ or >) to avoid false positives
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
