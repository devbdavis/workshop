import { execSync } from 'child_process';
import type { Session } from '@foundation/types';

/** Matches ANSI CSI sequences (e.g. SGR colour/style codes) preserved by `tmux capture-pane -e`. */
const ANSI_CSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
/** Matches ANSI OSC sequences (e.g. OSC 8 hyperlinks) ending in BEL or ST. */
const ANSI_OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

function stripAnsi(line: string): string {
  return line.replace(ANSI_OSC_RE, '').replace(ANSI_CSI_RE, '');
}

/** Capture the last N non-empty lines from a tmux pane (ANSI-stripped). */
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

/** Captured pane content with both ANSI-stripped text and ANSI-preserving raw forms.
 *  Both arrays are parallel-aligned: text[i] is the stripped form of raw[i]. */
export interface PaneCapture {
  text: string[];
  raw: string[];
}

/** Capture pane content once with ANSI codes preserved (`-e`) and return both
 *  the stripped text view and the raw view. Used by callers that need to
 *  inspect styling — e.g. distinguishing user-typed text from Claude's
 *  greyed-out ghost-suggestion text after the ❯ prompt. */
export function capturePane(tmuxSession: string, count = 20): PaneCapture {
  try {
    const output = execSync(
      `tmux capture-pane -t ${tmuxSession} -p -e`,
      { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 },
    );
    const lines = output.trimEnd().split('\n');
    const paired: { text: string; raw: string }[] = [];
    for (const raw of lines) {
      const text = stripAnsi(raw);
      if (text.trim() !== '') paired.push({ text, raw });
    }
    const slice = paired.slice(-count);
    return { text: slice.map(p => p.text), raw: slice.map(p => p.raw) };
  } catch {
    return { text: [], raw: [] };
  }
}

/** Returns true if the content immediately after the ❯ prompt on `rawLine`
 *  is styled dim (SGR 2) or grey (SGR 90 / 38;5;<grey>). That styling is how
 *  Claude's TUI renders its ghost auto-suggestion — the greyed-out text that
 *  appears after the prompt when no user input has been typed and that the
 *  user can accept with Tab.
 *
 *  Without this, a ghost suggestion like `❯ commit this` looks textually
 *  identical to user-typed text and would trip `isSessionNeedsInput`,
 *  flipping the session orb red while the user is actually idle. */
function isGhostSuggestionLine(rawLine: string): boolean {
  const idx = rawLine.indexOf('❯');
  if (idx === -1) return false;
  const after = rawLine.slice(idx + '❯'.length);
  let dimActive = false;
  let greyFgActive = false;
  let i = 0;
  while (i < after.length) {
    const m = /^\x1b\[([0-9;]*)m/.exec(after.slice(i));
    if (m) {
      // Parse SGR parameters (empty = 0 = full reset).
      const raw = m[1];
      const params: number[] = raw === ''
        ? [0]
        : raw.split(';').map(s => (s === '' ? 0 : Number.parseInt(s, 10)));
      let p = 0;
      while (p < params.length) {
        const code = params[p];
        if (code === 0) { dimActive = false; greyFgActive = false; }
        else if (code === 2) dimActive = true;
        else if (code === 22) dimActive = false;
        else if (code === 39) greyFgActive = false;
        else if (code === 90) greyFgActive = true;
        else if (code === 38 && params[p + 1] === 5) {
          const n = params[p + 2];
          // 8 = bright black; 232–250 covers the grayscale ramp + dark greys
          // Claude uses for prompt/suggestion accents.
          greyFgActive = n === 8 || (n >= 232 && n <= 250);
          p += 2;
        }
        p++;
      }
      i += m[0].length;
      continue;
    }
    const ch = after[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    // First visible character — its dim/grey state determines the answer.
    return dimActive || greyFgActive;
  }
  return false;
}

/** A line is an "idle prompt" if it shows the Claude ❯ prompt with no
 *  user-typed text after it. Bare ❯, > or `…❯` qualify, and so does
 *  `❯ <ghost-suggestion>` (when raw styling is available to verify). */
function isIdlePromptLine(textLine: string, rawLine: string | undefined): boolean {
  const t = textLine.trim();
  if (t === '❯' || t === '>' || t.endsWith('❯')) return true;
  if (rawLine && /^❯\s+\S/.test(t) && isGhostSuggestionLine(rawLine)) return true;
  return false;
}

/** Look up the raw line aligned to a text-array slice index.
 *  Assumes `rawArr` is the same length as `textArr` and indices match. */
function alignedRaw(
  rawArr: string[] | undefined,
  textArr: string[],
  sliceCount: number,
  idxInSlice: number,
): string | undefined {
  if (!rawArr) return undefined;
  if (rawArr.length !== textArr.length) return undefined;
  const sliceStart = Math.max(0, textArr.length - sliceCount);
  return rawArr[sliceStart + idxInSlice];
}

/** Check if the tmux pane shows an idle CLI prompt (❯ or > at end).
 *  The Claude TUI renders a status bar *below* the ❯ prompt line, so
 *  we scan the last several lines rather than just the very last one.
 *  We also verify there's no active work indicator (spinner/thinking).
 *
 *  When `preCapture` is provided, those stripped lines are used directly
 *  instead of calling `capturePaneLines()` internally. When `preCaptureRaw`
 *  is also provided (parallel-aligned with `preCapture`), the function can
 *  recognise `❯ <ghost-suggestion>` lines as idle — without raw, those would
 *  textually look like user-typed input and miss the idle classification. */
export function isSessionIdle(
  session: Session,
  preCapture?: string[],
  preCaptureRaw?: string[],
): boolean {
  const lines = preCapture ?? capturePaneLines(session.tmuxSession, 8);
  if (lines.length === 0) return false;
  // Active work indicators — scan ALL captured lines, not just the tail.
  // The TUI may render indicators above the prompt row; slicing to 8 would
  // miss them if the capture window is larger (e.g. the 20-line sync capture).
  //
  // `local agent(s) still running` covers the case where Claude has handed
  // control back to the user (idle ❯ prompt visible) but a sub-Agent task
  // is still running asynchronously — the TUI shows a status line like
  // "1 local agent still running · ↓ to manage". Without this we'd
  // mis-classify those sessions as idle and reap them mid-task.
  const allContent = lines.join(' ');
  if (/Running…|Thinking|thinking|esc to interrupt|local agents? still running/i.test(allContent)) return false;
  // Check if any of the last 8 lines contains an idle prompt indicator —
  // bare ❯/> OR ❯ + ghost-suggestion (the latter requires raw styling).
  return lines.slice(-8).some((line, idx) => {
    const raw = alignedRaw(preCaptureRaw, lines, 8, idx);
    return isIdlePromptLine(line, raw);
  });
}

/**
 * Check if the terminal session is waiting for user input mid-task.
 * Looks for interactive prompt patterns: y/n confirmations, question lines,
 * "press enter" prompts. Takes priority over isSessionIdle in the status chain.
 * When `preCapture` is provided, skip internal capturePaneLines() call.
 *
 * `preCaptureRaw` (parallel-aligned with `preCapture`) lets us distinguish
 * user-typed text after ❯ from Claude's greyed-out ghost suggestion. Without
 * it, a ghost like `❯ commit this fix` would falsely register as needs-input.
 */
export function isSessionNeedsInput(
  session: Session,
  preCapture?: string[],
  preCaptureRaw?: string[],
): boolean {
  const lines = preCapture ?? capturePaneLines(session.tmuxSession, 15);
  if (lines.length === 0) return false;
  // If the terminal is already showing an idle Claude prompt, the session is
  // waiting for the *next* message — not asking a mid-task question. User input
  // text visible in the scroll history (e.g. "is it ready?") would otherwise
  // trigger the `?`-ending-line heuristic as a false positive.
  // The idle check also accepts `❯ <ghost-suggestion>` (greyed) as an idle
  // prompt when raw lines are available, so we bail before treating ghost
  // text as user-typed needs-input.
  const atIdlePrompt = lines.slice(-8).some((line, idx) => {
    const raw = alignedRaw(preCaptureRaw, lines, 8, idx);
    return isIdlePromptLine(line, raw);
  });
  if (atIdlePrompt) return false;
  return lines.slice(-15).some((line, idx) => {
    const t = line.trimEnd();
    // Claude's input prompt with typed but not-yet-submitted text.
    // A bare ❯ is idle; ❯ followed by content means the user is composing —
    // unless that content is a ghost suggestion (handled by the early-bail
    // above using `isIdlePromptLine`).
    if (/^❯\s+\S/.test(t)) {
      // Defense in depth: if the early-bail didn't fire (e.g. ghost prompt
      // is in -15..-9 range, outside the -8 window above), recheck here.
      const raw = alignedRaw(preCaptureRaw, lines, 15, idx);
      if (raw && isGhostSuggestionLine(raw)) return false;
      return true;
    }
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
