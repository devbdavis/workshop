import type { TuiPrompt, TuiPromptOption } from '@foundation/tui-prompt-types';

// Single digit only: digits are the answer keys, and 1-9 is all the key whitelist sends.
const OPTION_RE = /^(\s*(?:❯\s*)?)([1-9])\.\s+(?:\[([ ✔✓x])\]\s+)?(.+?)\s*$/;
// A live dialog's footer is at the bottom of the pane; one higher up is scrollback (e.g. a file mentioning it).
const FOOTER_WINDOW = 3;
const FOOTER_RE = /Esc to cancel/;
const TAB_BAR_RE = /✔\s*Submit\s*→/;
const SEPARATOR_RE = /^\s*[─-]{3,}\s*$/;
// The ☐ header line ("☐ Color") and the tab bar are chrome, not part of the question.
const CHROME_RE = /^\s*(?:[←☐☒]|.*✔\s*Submit\s*→)/;
const MAX_QUESTION_LINES = 6;

/** Parses a Claude Code dialog (numbered options + "Esc to cancel" footer) from pane lines; null if none is showing. */
export function parseTuiPrompt(lines: string[]): TuiPrompt | null {
  let footerIdx = lines.map((l) => FOOTER_RE.test(l)).lastIndexOf(true);
  if (footerIdx < lines.length - FOOTER_WINDOW) footerIdx = -1;
  const hasSubmitTab = lines.some((l) => TAB_BAR_RE.test(l));
  if (footerIdx === -1 && !hasSubmitTab) return null;
  const body = footerIdx === -1 ? lines : lines.slice(0, footerIdx);

  let options: TuiPromptOption[] = [];
  let firstIdx = -1;
  let current: TuiPromptOption | null = null;
  let currentCol = 0;
  body.forEach((line, i) => {
    const m = OPTION_RE.exec(line);
    if (m) {
      const n = Number(m[2]);
      // "1." restarts the list so an earlier numbered list in scrollback is discarded.
      if (n === 1) { options = []; firstIdx = i; }
      if (firstIdx === -1) return;
      current = { n, label: m[4], ...(m[3] !== undefined && { checked: m[3] !== ' ' }) };
      currentCol = m[1].length;
      options.push(current);
    } else if (SEPARATOR_RE.test(line)) {
      current = null;
    } else if (current && line.length - line.trimStart().length > currentCol) {
      current.description = current.description ? `${current.description} ${line.trim()}` : line.trim();
    }
  });
  if (options.length === 0) {
    // Unnumbered dialog (e.g. the trust prompt): no buttons, but the screen + arrow/Enter keys still answer it.
    if (footerIdx === -1) return null;
    const screen = lines.slice(Math.max(0, footerIdx - 12), footerIdx + 1).map((l) => l.trimEnd());
    return { question: '', options: [], hasSubmitTab, screen };
  }

  // The dialog starts below the last separator above its options; anything higher is scrollback.
  const start = Math.max(Math.max(0, firstIdx - MAX_QUESTION_LINES), body.slice(0, firstIdx).map((l) => SEPARATOR_RE.test(l)).lastIndexOf(true) + 1);
  const question = body.slice(start, firstIdx).filter((l) => !CHROME_RE.test(l)).map((l) => l.trim()).join('\n');
  const screen = lines.slice(start).map((l) => l.trimEnd());
  return { question, options, hasSubmitTab, screen };
}
