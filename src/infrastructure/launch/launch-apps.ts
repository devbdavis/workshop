import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

/**
 * Editor and terminal launcher for "Open in Cursor" / "Open in Terminal" buttons.
 *
 * Detects the host platform (macOS / Linux / WSL) once at module load and resolves
 * which CLIs are present on $PATH. Settings can override the auto-detected choice.
 *
 * Linux Konsole/gnome-terminal/code/cursor are launched via their CLI shims.
 * macOS uses `open -a` as a fallback when the CLI shim is missing.
 * WSL targets Windows Terminal via `wt.exe` for terminals and the VSCode Remote
 * `code` shim for the editor.
 */

export type Platform = 'darwin' | 'linux' | 'wsl' | 'unknown';

export type EditorChoice = 'auto' | 'cursor' | 'code';
export type TerminalChoice = 'auto' | 'iterm' | 'konsole' | 'gnome-terminal' | 'wt';

const EDITOR_VALUES = new Set<string>(['auto', 'cursor', 'code']);
const TERMINAL_VALUES = new Set<string>(['auto', 'iterm', 'konsole', 'gnome-terminal', 'wt']);

export function isEditorChoice(value: unknown): value is EditorChoice {
  return typeof value === 'string' && EDITOR_VALUES.has(value);
}

export function isTerminalChoice(value: unknown): value is TerminalChoice {
  return typeof value === 'string' && TERMINAL_VALUES.has(value);
}

export function parseEditorChoice(value: unknown): EditorChoice {
  return isEditorChoice(value) ? value : 'auto';
}

export function parseTerminalChoice(value: unknown): TerminalChoice {
  return isTerminalChoice(value) ? value : 'auto';
}

const IS_WSL = (() => {
  try {
    return /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
})();

export function detectPlatform(): Platform {
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'linux') return IS_WSL ? 'wsl' : 'linux';
  return 'unknown';
}

/** Returns true if the named binary is on $PATH. Cached per process. */
const cliCache = new Map<string, boolean>();

export function hasCli(name: string): boolean {
  const cached = cliCache.get(name);
  if (cached !== undefined) return cached;
  let found = false;
  try {
    // `command -v` is POSIX and works in sh/bash; macOS and Linux both have it.
    execSync(`command -v ${JSON.stringify(name)} >/dev/null 2>&1`, { stdio: 'ignore' });
    found = true;
  } catch {
    found = false;
  }
  cliCache.set(name, found);
  return found;
}

/** Snapshot of which launchers are available on this host. */
export interface AppAvailability {
  platform: Platform;
  editors: {
    cursor: boolean;
    code: boolean;
  };
  terminals: {
    iterm: boolean;
    konsole: boolean;
    gnomeTerminal: boolean;
    wt: boolean;
  };
}

export function detectAvailability(): AppAvailability {
  const platform = detectPlatform();
  return {
    platform,
    editors: {
      cursor: hasCli('cursor') || (platform === 'darwin' && existsSync('/Applications/Cursor.app')),
      code:
        hasCli('code') ||
        (platform === 'darwin' && existsSync('/Applications/Visual Studio Code.app')),
    },
    terminals: {
      // iTerm: macOS-only, detected by the `.app` bundle (no CLI shim by default).
      iterm: platform === 'darwin' && existsSync('/Applications/iTerm.app'),
      konsole: platform === 'linux' && hasCli('konsole'),
      gnomeTerminal: platform === 'linux' && hasCli('gnome-terminal'),
      // wt.exe lives on the Windows side; from WSL it's typically on the interop $PATH.
      wt: platform === 'wsl' && hasCli('wt.exe'),
    },
  };
}

/** Concrete editor (excludes the 'auto' sentinel). */
export type ResolvedEditor = 'cursor' | 'code';

/** Concrete terminal (excludes the 'auto' sentinel). */
export type ResolvedTerminal = 'iterm' | 'konsole' | 'gnome-terminal' | 'wt';

/** Pick the right editor for this host given the user's preference. */
export function resolveEditor(choice: EditorChoice, avail: AppAvailability): ResolvedEditor | null {
  if (choice === 'cursor') return avail.editors.cursor ? 'cursor' : null;
  if (choice === 'code') return avail.editors.code ? 'code' : null;
  // auto: prefer cursor on darwin (existing behaviour), otherwise prefer cursor → code
  if (avail.editors.cursor) return 'cursor';
  if (avail.editors.code) return 'code';
  return null;
}

/** Pick the right terminal for this host given the user's preference. */
export function resolveTerminal(choice: TerminalChoice, avail: AppAvailability): ResolvedTerminal | null {
  if (choice === 'iterm') return avail.terminals.iterm ? 'iterm' : null;
  if (choice === 'konsole') return avail.terminals.konsole ? 'konsole' : null;
  if (choice === 'gnome-terminal') return avail.terminals.gnomeTerminal ? 'gnome-terminal' : null;
  if (choice === 'wt') return avail.terminals.wt ? 'wt' : null;
  // auto: pick the platform-native default, falling back to anything present
  if (avail.platform === 'darwin' && avail.terminals.iterm) return 'iterm';
  if (avail.platform === 'wsl' && avail.terminals.wt) return 'wt';
  if (avail.platform === 'linux') {
    if (avail.terminals.konsole) return 'konsole';
    if (avail.terminals.gnomeTerminal) return 'gnome-terminal';
  }
  return null;
}

/**
 * Resolve the path to open in the editor. If a `.code-workspace` file exists
 * (per-session or co-located), prefer that; both VSCode and Cursor recognise
 * the format and will restore the multi-root workspace correctly.
 */
export function resolveEditorTarget(targetPath: string, sessionId: string | undefined): string {
  const sessionWorkspaceFile = sessionId
    ? path.join(process.env.HOME || '/tmp', '.workshop', 'sessions', sessionId, 'workspace', 'workspace.code-workspace')
    : null;
  if (sessionWorkspaceFile && existsSync(sessionWorkspaceFile)) return sessionWorkspaceFile;
  const colocated = path.join(targetPath, 'workspace.code-workspace');
  if (existsSync(colocated)) return colocated;
  return targetPath;
}

export interface LaunchOpts {
  /** Tab/window title hint where the launcher supports one. */
  title?: string;
}

/**
 * Spawn the editor. Throws on failure so the caller can return a 500.
 *
 * For `cursor` on macOS we keep the existing behaviour: try the CLI first
 * (faster, picks up the current session), fall back to `open -a Cursor`.
 */
export function launchEditor(editor: ResolvedEditor, target: string, platform: Platform): void {
  const quoted = JSON.stringify(target);
  if (editor === 'code') {
    // On macOS the `code` shim is often hijacked by Cursor, so target VSCode by
    // its bundle id (immune to $PATH) and fall back to the CLI only if that fails.
    if (platform === 'darwin') {
      try {
        execSync(`open -b com.microsoft.VSCode ${quoted}`, { stdio: 'pipe' });
      } catch {
        execSync(`code ${quoted}`, { stdio: 'pipe' });
      }
      return;
    }
    execSync(`code ${quoted}`, { stdio: 'pipe' });
    return;
  }
  // cursor
  if (platform === 'darwin') {
    try {
      execSync(`cursor ${quoted}`, { stdio: 'pipe' });
    } catch {
      execSync(`open -a Cursor ${quoted}`, { stdio: 'pipe' });
    }
    return;
  }
  execSync(`cursor ${quoted}`, { stdio: 'pipe' });
}

/**
 * Spawn the terminal at the given working directory. Throws on failure.
 *
 * - iTerm (macOS): `open -a iTerm <path>` — opens a new window pinned to the directory.
 * - Konsole (Linux): `konsole --new-tab --workdir <path>` (detached so we don't block on
 *   the GUI process). `--new-tab` opens in the existing Konsole window if one is running,
 *   matching iTerm's tab-reuse behaviour; otherwise Konsole creates a new window.
 * - gnome-terminal (Linux): `gnome-terminal --working-directory=<path>`.
 * - Windows Terminal (WSL): `wt.exe -w 0 nt --profile <distro> wsl.exe --cd <path>`,
 *   matching the prior inline implementation.
 */
export function launchTerminal(
  terminal: ResolvedTerminal,
  targetPath: string,
  opts: LaunchOpts = {},
): void {
  const quoted = JSON.stringify(targetPath);
  switch (terminal) {
    case 'iterm':
      execSync(`open -a iTerm ${quoted}`, { stdio: 'pipe' });
      return;
    case 'konsole': {
      // `nohup … &` so Konsole survives this short-lived child shell exiting,
      // and we redirect output so it doesn't tie up our pipe.
      // `--new-tab` reuses an existing Konsole window if one is running (matching
      // iTerm's tab-reuse behaviour); otherwise Konsole opens a new window.
      const titleArgs = opts.title ? `-p tabtitle=${JSON.stringify(opts.title)} ` : '';
      execSync(`nohup konsole --new-tab ${titleArgs}--workdir ${quoted} >/dev/null 2>&1 &`, {
        stdio: 'pipe',
        shell: '/bin/sh',
      });
      return;
    }
    case 'gnome-terminal': {
      const titleArgs = opts.title ? `--title=${JSON.stringify(opts.title)} ` : '';
      execSync(`nohup gnome-terminal ${titleArgs}--working-directory=${quoted} >/dev/null 2>&1 &`, {
        stdio: 'pipe',
        shell: '/bin/sh',
      });
      return;
    }
    case 'wt': {
      const distro = process.env['WSL_DISTRO_NAME'];
      const profileArgs = distro ? `--profile ${JSON.stringify(distro)} ` : '';
      const titleArgs = opts.title ? `--title ${JSON.stringify(opts.title)} ` : '';
      execSync(`wt.exe -w 0 nt ${titleArgs}${profileArgs}wsl.exe --cd ${quoted}`, { stdio: 'pipe' });
      return;
    }
  }
}
