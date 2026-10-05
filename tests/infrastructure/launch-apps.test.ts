import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  isEditorChoice,
  isTerminalChoice,
  parseEditorChoice,
  parseTerminalChoice,
  resolveEditor,
  resolveTerminal,
  resolveEditorTarget,
  type AppAvailability,
} from '@infrastructure/launch/launch-apps';

function avail(overrides: Partial<AppAvailability> = {}): AppAvailability {
  return {
    platform: 'linux',
    editors: { cursor: false, code: false },
    terminals: { iterm: false, konsole: false, gnomeTerminal: false, wt: false },
    ...overrides,
  } as AppAvailability;
}

describe('parseEditorChoice', () => {
  it('accepts known editors', () => {
    expect(parseEditorChoice('cursor')).toBe('cursor');
    expect(parseEditorChoice('code')).toBe('code');
    expect(parseEditorChoice('auto')).toBe('auto');
  });
  it('falls back to auto for unknown / null', () => {
    expect(parseEditorChoice(null)).toBe('auto');
    expect(parseEditorChoice('vim')).toBe('auto');
    expect(parseEditorChoice(undefined)).toBe('auto');
  });
});

describe('parseTerminalChoice', () => {
  it('accepts known terminals', () => {
    expect(parseTerminalChoice('iterm')).toBe('iterm');
    expect(parseTerminalChoice('konsole')).toBe('konsole');
    expect(parseTerminalChoice('gnome-terminal')).toBe('gnome-terminal');
    expect(parseTerminalChoice('wt')).toBe('wt');
  });
  it('falls back to auto for unknown / null', () => {
    expect(parseTerminalChoice(null)).toBe('auto');
    expect(parseTerminalChoice('alacritty')).toBe('auto');
  });
});

describe('isEditorChoice / isTerminalChoice', () => {
  it('rejects non-string values', () => {
    expect(isEditorChoice(42)).toBe(false);
    expect(isTerminalChoice({})).toBe(false);
  });
});

describe('resolveEditor', () => {
  it('returns null when nothing is installed', () => {
    expect(resolveEditor('auto', avail())).toBeNull();
    expect(resolveEditor('cursor', avail())).toBeNull();
    expect(resolveEditor('code', avail())).toBeNull();
  });

  it('respects an explicit choice when available', () => {
    expect(
      resolveEditor('code', avail({ editors: { cursor: true, code: true } })),
    ).toBe('code');
    expect(
      resolveEditor('cursor', avail({ editors: { cursor: true, code: true } })),
    ).toBe('cursor');
  });

  it('returns null when explicit choice is missing', () => {
    expect(
      resolveEditor('code', avail({ editors: { cursor: true, code: false } })),
    ).toBeNull();
  });

  it('auto prefers cursor, then falls back to code', () => {
    expect(
      resolveEditor('auto', avail({ editors: { cursor: true, code: true } })),
    ).toBe('cursor');
    expect(
      resolveEditor('auto', avail({ editors: { cursor: false, code: true } })),
    ).toBe('code');
  });
});

describe('resolveTerminal', () => {
  it('auto picks iterm on darwin', () => {
    expect(
      resolveTerminal(
        'auto',
        avail({ platform: 'darwin', terminals: { iterm: true, konsole: false, gnomeTerminal: false, wt: false } }),
      ),
    ).toBe('iterm');
  });

  it('auto picks wt on wsl', () => {
    expect(
      resolveTerminal(
        'auto',
        avail({ platform: 'wsl', terminals: { iterm: false, konsole: false, gnomeTerminal: false, wt: true } }),
      ),
    ).toBe('wt');
  });

  it('auto on linux prefers konsole, then gnome-terminal', () => {
    expect(
      resolveTerminal(
        'auto',
        avail({ terminals: { iterm: false, konsole: true, gnomeTerminal: true, wt: false } }),
      ),
    ).toBe('konsole');
    expect(
      resolveTerminal(
        'auto',
        avail({ terminals: { iterm: false, konsole: false, gnomeTerminal: true, wt: false } }),
      ),
    ).toBe('gnome-terminal');
  });

  it('returns null when explicit choice is missing', () => {
    expect(
      resolveTerminal(
        'konsole',
        avail({ terminals: { iterm: false, konsole: false, gnomeTerminal: true, wt: false } }),
      ),
    ).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(resolveTerminal('auto', avail({ platform: 'unknown' }))).toBeNull();
  });
});

describe('resolveEditorTarget portable', () => {
  function dirWithWorkspace(folderPath: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'editor-target-'));
    writeFileSync(path.join(dir, 'workspace.code-workspace'), JSON.stringify({ folders: [{ path: folderPath }] }));
    return dir;
  }

  it('keeps a workspace file with relative folders for remote links', () => {
    const dir = dirWithWorkspace('workshop');
    expect(resolveEditorTarget(dir, undefined, true)).toBe(path.join(dir, 'workspace.code-workspace'));
  });

  it('falls back to the folder when the workspace file lists absolute container paths', () => {
    const dir = dirWithWorkspace('/repos');
    expect(resolveEditorTarget(dir, undefined, true)).toBe(dir);
    expect(resolveEditorTarget(dir, undefined)).toBe(path.join(dir, 'workspace.code-workspace'));
  });
});
