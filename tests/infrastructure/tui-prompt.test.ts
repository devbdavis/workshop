import { describe, it, expect } from 'vitest';
import { parseTuiPrompt } from '@infrastructure/terminal/tui-prompt';

const lines = (s: string): string[] => s.split('\n').filter((l) => l.trim() !== '');

describe('parseTuiPrompt', () => {
  it('parses a single-select question with descriptions', () => {
    const p = parseTuiPrompt(lines(`
 ☐ Color

Pick a color

❯ 1. Red
     Choose Red
  2. Green
     Choose Green
  3. Blue
     Choose Blue
  4. Type something.
────────────────────────────────
  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel`));
    expect(p?.question).toBe('Pick a color');
    expect(p?.options.map((o) => o.n)).toEqual([1, 2, 3, 4, 5]);
    expect(p?.options[0]).toEqual({ n: 1, label: 'Red', description: 'Choose Red' });
    expect(p?.options[3].description).toBeUndefined();
    expect(p?.options[4].label).toBe('Chat about this');
    expect(p?.hasSubmitTab).toBe(false);
  });

  it('parses multiSelect with tab bar and no footer', () => {
    const p = parseTuiPrompt(lines(`
←  ☐ Fruits  ✔ Submit  →

Pick fruits

❯ 1. [ ] Apple
         Choose Apple
  2. [✔] Banana
         Choose Banana
  3. [ ] Cherry
         Choose Cherry
  4. [ ] Type something
     Submit`));
    expect(p?.hasSubmitTab).toBe(true);
    expect(p?.question).toBe('Pick fruits');
    expect(p?.options.map((o) => o.checked)).toEqual([false, true, false, false]);
    expect(p?.options[0].label).toBe('Apple');
  });

  it('parses a permission dialog', () => {
    const p = parseTuiPrompt(lines(`
 Bash command
 Create empty file probe.txt
 touch probe.txt
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to /tmp/x from this project
   3. Yes, and switch to auto mode · auto mode handles these prompts for you
   4. No
 Esc to cancel · Tab to amend`));
    expect(p?.question).toBe('Bash command\nCreate empty file probe.txt\ntouch probe.txt\nDo you want to proceed?');
    expect(p?.options).toHaveLength(4);
    expect(p?.options[3]).toEqual({ n: 4, label: 'No' });
  });

  it('drops scrollback above the dialog separator (live capture)', () => {
    const p = parseTuiPrompt(lines(`▎ https://clau.de/api-credits
❯ Use AskUserQuestion to ask me one question
────────────────────────────────
 ☐ Size
Pick a size
❯ 1. S
     Small
  2. M
     Medium
  4. Type something.
────────────────────────────────
  5. Chat about this
Enter to select · ↑/↓ to navigate · Esc to cancel`));
    expect(p?.question).toBe('Pick a size');
    expect(p?.screen[0]).toBe(' ☐ Size');
    expect(p?.options.map((o) => o.n)).toEqual([1, 2, 4, 5]);
  });

  it('surfaces an unnumbered dialog as screen-only', () => {
    const p = parseTuiPrompt(lines(' Is this a project you trust?\n ❯ No, exit\n   Yes, I trust this folder\n Enter to confirm · Esc to cancel'));
    expect(p?.options).toEqual([]);
    expect(p?.screen.at(-1)).toContain('Esc to cancel');
  });

  it('ignores an "Esc to cancel" in scrollback above the bottom of the pane', () => {
    expect(parseTuiPrompt(lines('const FOOTER_RE = /Esc to cancel/;\n1. one\n2. two\n● Done.\nline a\nline b\n❯ '))).toBeNull();
  });

  it('returns null with no dialog', () => {
    expect(parseTuiPrompt(lines('● Done.\n\n1. not a dialog\n2. just prose\n❯ '))).toBeNull();
    expect(parseTuiPrompt([])).toBeNull();
  });
});
