import { describe, it, expect } from 'vitest';
import { trustDialogKey } from '@infrastructure/terminal/pane-detection.js';

// Shape of a real capture: the shell's own `❯` prompt echo sits above the dialog.
const dialog = (cursorOn: 'no' | 'yes') => [
  ' ~ ',
  '❯ /Users/me/.workshop/sessions/abc/launch.sh',
  '',
  ' Accessing workspace:',
  '',
  ' /Users/me',
  '',
  ' Quick safety check: Is this a project you created or one you trust?',
  '',
  cursorOn === 'no' ? ' ❯ No, exit' : '   No, exit',
  cursorOn === 'yes' ? ' ❯ Yes, I trust this folder' : '   Yes, I trust this folder',
  '',
  ' Enter to confirm · Esc to cancel',
].join('\n');

describe('trustDialogKey', () => {
  it('moves the cursor when the dialog defaults to "No, exit"', () => {
    expect(trustDialogKey(dialog('no'))).toBe('Down');
  });

  it('confirms once the cursor sits on the trust option', () => {
    expect(trustDialogKey(dialog('yes'))).toBe('Enter');
  });

  it('ignores panes without the dialog', () => {
    expect(trustDialogKey('❯ ls -la\ntotal 0\n')).toBeNull();
  });

  it('waits while the dialog is still rendering (no cursor yet)', () => {
    expect(trustDialogKey('   Yes, I trust this folder\n   No, exit\n')).toBeNull();
  });
});
