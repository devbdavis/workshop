import { execSync, execFileSync, exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, chmodSync, symlinkSync } from 'fs';

const execAsync = promisify(exec);
import path from 'path';
import { v4 as uuid } from 'uuid';
import type { SessionRepository } from '@domain/session/repository';
import type { Session, SessionId, TrackId, TrackRepo } from '@foundation/types';
import type { SoulLoader } from '@infrastructure/soul/soul-loader.js';
import type { TodoRepository } from '@domain/todo/repository.js';
import type { PluginRepository } from '@domain/plugin/repository';
import { toEnabledPluginsMap } from '@domain/plugin/repository.js';
import { readAgentsRules } from '@infrastructure/plugins/rules-writer.js';
import {
  capturePaneLines, isSessionIdle, isSessionNeedsInput, isSessionLoggedOut, isSessionExited,
  trustDialogKey,
} from './pane-detection.js';
import {
  buildClaudeLauncher, buildGeminiLauncher, buildCodexLauncher, buildCursorLauncher,
  sendInitialPrompt,
} from './launcher-builders.js';

// Re-export domain interfaces so existing consumers are not broken
export type { TerminalManager, CreateSessionOptions, SyncResult } from '@domain/terminal/manager.js';
import type { TerminalManager, CreateSessionOptions, SyncResult } from '@domain/terminal/manager.js';

/** Directory for per-session data (prompt files, hook config, etc.) */
const SESSION_DATA_DIR = path.join(
  process.env.HOME || '/tmp',
  '.workshop',
  'sessions',
);

/**
 * Nix devshell environment variables that contaminate child processes when
 * tmux is started from inside a `nix develop` shell. These are passed via
 * tmux's global environment to every new session, which breaks `nix develop`
 * invocations inside Workshop sessions (e.g. MCP server startup).
 *
 * We clear them at session-creation time using tmux's `-e VAR=` flag, which
 * overrides the global environment for that specific session only.
 */
const NIX_DEVSHELL_VARS = [
  // nix develop / nix shell markers and build env
  'IN_NIX_SHELL',
  'CONFIG_SHELL',
  'HOST_PATH',
  'CFLAGS',
  'CPPFLAGS',
  'LDFLAGS',
  'NIX_CC',
  'NIX_BINTOOLS',
  'NIX_BUILD_CORES',
  'NIX_CFLAGS_COMPILE',
  'NIX_LDFLAGS',
  'NIX_APPLE_SDK_VERSION',
  'NIX_DONT_SET_RPATH',
  'NIX_DONT_SET_RPATH_FOR_BUILD',
  'NIX_ENFORCE_NO_NATIVE',
  'NIX_HARDENING_ENABLE',
  'NIX_IGNORE_LD_THROUGH_GCC',
  'NIX_NO_SELF_RPATH',
  // npm_config_* vars set by nix node packages — conflict with nvm in session shells
  'npm_config_prefix',
  'npm_config_global_prefix',
  'npm_config_globalconfig',
  'npm_config_local_prefix',
  'npm_config_node_gyp',
  'npm_config_noproxy',
  'npm_config_npm_version',
  'npm_config_user_agent',
  'npm_config_userconfig',
  'npm_config_cache',
  'npm_config_init_module',
  // direnv state vars — cause direnv to unload on every session start
  'DIRENV_DIR',
  'DIRENV_FILE',
  'DIRENV_DIFF',
  'DIRENV_WATCHES',
] as const;

/** tmux `-e VAR=` flags that clear nix devshell contamination for new sessions.
 *  Only emitted for vars that are actually present — avoids spuriously setting
 *  empty vars on machines that don't have nix/direnv, which can trigger direnv
 *  hooks and introduce shell startup latency that causes send-keys races. */
export const NIX_CLEAN_TMUX_FLAGS = NIX_DEVSHELL_VARS
  .filter((v) => v in process.env)
  .map((v) => `-e ${v}=`)
  .join(' ');

/**
 * Propagate PATH from the Workshop server process into every new tmux session.
 *
 * tmux sessions inherit their environment from the tmux *server's* global
 * environment (set when the server first started), not from the process that
 * runs `tmux new-session`. On machines without a system-level Node install
 * (e.g. WSL using nix flakes), the server-start-time PATH may not include the
 * nix store paths where `claude` lives. Explicitly passing Workshop's own PATH
 * ensures the session shell can reach whatever tools Workshop itself can reach.
 */
export const TMUX_PATH_FLAG = process.env.PATH
  ? `-e PATH=${JSON.stringify(process.env.PATH)}`
  : '';

/**
 * Configure a freshly created tmux session for Workshop's browser terminal.
 *
 * - `mouse off`: xterm.js handles selection (soft-wrap aware) and cursor
 *   natively. Scroll is handled by a capture-based scrollback overlay
 *   (see websocket.ts capture-scrollback handler).
 * - `set-clipboard on`: OSC 52 clipboard passthrough.
 * - `status off`: hides the tmux status bar so the live terminal and
 *   scrollback overlay are visually identical (no jarring bar appearing
 *   and disappearing during transitions).
 * - `history-limit 5000`: provides generous scrollback for the capture
 *   overlay without making capture responses too large.
 *
 * These are set per-session so Workshop owns the UX regardless of ~/.tmux.conf.
 *
 * Also ensures the *server-wide* `terminal-features` list includes
 * `hyperlinks` — see ensureTmuxHyperlinks() for the rationale.
 */
export function configureTmuxSession(tmuxName: string): void {
  try {
    execSync(`tmux set-option -t ${tmuxName} mouse off`, { stdio: 'pipe' });
    execSync(`tmux set-option -t ${tmuxName} set-clipboard on`, { stdio: 'pipe' });
    execSync(`tmux set-option -t ${tmuxName} status off`, { stdio: 'pipe' });
    execSync(`tmux set-option -t ${tmuxName} history-limit 5000`, { stdio: 'pipe' });
  } catch (err) {
    console.warn(`[tmux] Failed to configure session ${tmuxName}:`, err);
  }

  ensureTmuxHyperlinks();
}

/**
 * Ensure tmux passes through OSC 8 hyperlinks to the attached client.
 *
 * Background: the workshop client attaches via node-pty with TERM=xterm-256color.
 * tmux 3.6's default `terminal-features` for `xterm*` is `clipboard:ccolour:
 * cstyle:focus:title` — no `hyperlinks`. Without that feature, tmux strips
 * OSC 8 escape sequences (the ones Claude's TUI emits for markdown links)
 * when rendering its internal cell buffer out to the attached client. The
 * `capture-pane -e` path preserves them in raw form — which is exactly why
 * markdown links were clickable in the scrollback overlay but not in the
 * live pane.
 *
 * Fix: append `*:hyperlinks` to the server-wide terminal-features list.
 * This is idempotent — we check first to avoid accumulating duplicates
 * across session creates and tmux server restarts. Cached at module scope
 * so we only pay for the show-options round-trip once per server lifetime.
 */
let hyperlinksConfigured = false;
function ensureTmuxHyperlinks(): void {
  if (hyperlinksConfigured) return;
  try {
    const features = execSync('tmux show-options -gs terminal-features', {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    if (!features.includes('hyperlinks')) {
      execSync('tmux set-option -as terminal-features "*:hyperlinks"', { stdio: 'pipe' });
    }
    hyperlinksConfigured = true;
  } catch (err) {
    // Older tmux (< 3.2) doesn't support terminal-features — degrades gracefully
    // to "no live hyperlinks", same as before this fix.
    console.warn('[tmux] Could not enable hyperlinks feature (older tmux?):', err);
  }
}

/** Seconds a dead tmux session gets before being reaped/suspended */
const DYING_GRACE_PERIOD_MS = 30_000;

/** Cache dirs to symlink from the canonical clone into each worktree */
const WORKTREE_SYMLINK_DIRS = ['node_modules', '.venv'];

interface WorktreeMeta {
  repos: Array<{ path: string; name: string }>;
}

/** Subset of .claude/settings.json we read and merge across repos */
interface ClaudeProjectSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  env?: Record<string, string>;
}

/**
 * Slugify a session name into a git-safe branch name component.
 * Output: `workshop/{slug}-{shortId}[-{issueKey}]` — at most ~60 chars total.
 */
function worktreeBranchName(name: string | undefined, sessionId: string, issueKey?: string): string {
  const slug = name
    ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    : 'task';
  const base = `workshop/${slug}-${sessionId.slice(0, 6)}`;
  // Sanitize the key — GitHub keys ("owner/repo#123") carry chars that aren't git-ref safe.
  const safeKey = issueKey?.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safeKey ? `${base}-${safeKey}` : base;
}

/**
 * Hard upper bound on how long we'll wait for `git fetch origin` before giving up
 * and falling back to whatever `origin/<branch>` the local clone already knows.
 * GitHub has periods of flakiness where fetches hang indefinitely; blocking
 * session creation on that is worse than starting a few commits behind.
 *
 * 30s is intentionally generous — short enough that a wedged fetch doesn't make
 * session creation feel broken, but long enough that a slow-but-healthy fetch
 * (large repos, transient GitHub latency, slow network) completes successfully
 * rather than always falling back to a stale origin ref. Earlier 15s was tripping
 * on healthy-but-slow days, leaving worktrees several commits behind main.
 */
const GIT_FETCH_TIMEOUT_MS = 30_000;

/**
 * Fetch origin and return the remote-tracking ref for its HEAD branch (e.g. "origin/main").
 * Returns undefined if the repo has no remote or the ref cannot be determined — callers
 * fall back to creating the worktree from the current HEAD.
 *
 * Runs git commands via execAsync so the Node event loop stays free during network I/O.
 * The fetch itself is bounded by GIT_FETCH_TIMEOUT_MS; on timeout or any other
 * failure we fall through to the last-known `origin/<branch>` ref.
 */
async function fetchAndResolveBase(repoPath: string): Promise<string | undefined> {
  try {
    await execAsync(
      `git -C ${JSON.stringify(repoPath)} fetch origin --quiet`,
      { timeout: GIT_FETCH_TIMEOUT_MS, killSignal: 'SIGKILL' },
    );
  } catch (err) {
    // Log so the failure is visible in server output — but don't bail; we can
    // still create the worktree from whatever remote-tracking ref exists locally.
    // Distinguish timeout (GitHub slow/down) from other errors (auth, network, etc.)
    // so operators can tell "we're stale" from "fetch is genuinely broken".
    const e = err as NodeJS.ErrnoException & { signal?: string; killed?: boolean };
    const timedOut = e?.killed === true || e?.signal === 'SIGKILL';
    console.warn(
      timedOut
        ? `[worktree] git fetch origin timed out after ${GIT_FETCH_TIMEOUT_MS}ms for ${repoPath} — falling back to last-known origin ref`
        : `[worktree] git fetch origin failed for ${repoPath}: ${err instanceof Error ? err.message.trim() : err}`,
    );
  }

  // Derive the remote ref from the local HEAD's branch name — the canonical clone
  // always knows which branch it's on, and fetch just updated origin/<branch>.
  try {
    const { stdout } = await execAsync(
      `git -C ${JSON.stringify(repoPath)} rev-parse --abbrev-ref HEAD`,
    );
    const localBranch = stdout.trim(); // e.g. "main"

    if (localBranch && localBranch !== 'HEAD') {
      const remoteRef = `origin/${localBranch}`;
      // Verify the ref actually exists before handing it to worktree add
      await execAsync(
        `git -C ${JSON.stringify(repoPath)} rev-parse --verify ${JSON.stringify(remoteRef)}`,
      );
      console.log(`[worktree] using ${remoteRef} as start point for ${repoPath}`);
      return remoteRef;
    }
  } catch { /* fall through */ }

  console.warn(`[worktree] Could not resolve remote base ref for ${repoPath} — worktree will start from local HEAD`);
  return undefined;
}

/**
 * Create a workspace directory with one git worktree per repo.
 * Fetches from origin so each worktree starts from the latest remote HEAD,
 * even if the local default branch is behind.
 * All repos are processed in parallel — significant speedup for multi-repo tracks.
 * Returns the workspace path. Throws on failure (caller should handle gracefully).
 */
async function createWorktrees(sessionId: string, repos: TrackRepo[], sessionName?: string, issueKey?: string, agentsRules?: string | null): Promise<string> {
  const workspaceDir = path.join(SESSION_DATA_DIR, sessionId, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });

  const branch = worktreeBranchName(sessionName, sessionId, issueKey);

  await Promise.all(repos.map(async (repo) => {
    const repoName = path.basename(repo.path);
    const worktreePath = path.join(workspaceDir, repoName);

    const base = await fetchAndResolveBase(repo.path);
    const startPoint = base ? ` ${JSON.stringify(base)}` : '';
    await execAsync(
      `git -C ${JSON.stringify(repo.path)} worktree add ${JSON.stringify(worktreePath)} -b ${JSON.stringify(branch)}${startPoint}`,
    );

    const symlinksMade: string[] = [];
    for (const dir of WORKTREE_SYMLINK_DIRS) {
      const src = path.join(repo.path, dir);
      const dst = path.join(worktreePath, dir);
      if (existsSync(src) && !existsSync(dst)) {
        try {
          symlinkSync(src, dst);
          symlinksMade.push(dir);
        } catch {
          // Non-fatal — agent can reinstall if needed
        }
      }
    }

    // Suppress symlinked dirs in the per-worktree exclude file so
    // `git status` stays clean. The .git file contains the gitdir path.
    if (symlinksMade.length > 0) {
      try {
        const gitFileContent = readFileSync(path.join(worktreePath, '.git'), 'utf-8');
        const match = gitFileContent.match(/^gitdir:\s*(.+)$/m);
        if (match) {
          const worktreeGitDir = match[1].trim();
          const infoDir = path.join(worktreeGitDir, 'info');
          mkdirSync(infoDir, { recursive: true });
          const excludePath = path.join(infoDir, 'exclude');
          const excludeLines = symlinksMade.map((d) => `/${d}`).join('\n') + '\n';
          writeFileSync(excludePath, excludeLines, 'utf-8');
        }
      } catch {
        // Non-fatal — cosmetic only
      }
    }
  }));

  // Write metadata so cleanup can locate the original repo paths
  const meta: WorktreeMeta = {
    repos: repos.map((r) => ({ path: r.path, name: path.basename(r.path) })),
  };
  writeFileSync(path.join(workspaceDir, '.worktree-meta.json'), JSON.stringify(meta), 'utf-8');

  // Write merged .claude/settings.json and workspace.code-workspace
  try {
    writeWorkspaceArtifacts(workspaceDir, repos, sessionName, agentsRules);
  } catch (err) {
    console.warn('[worktree] Failed to write workspace artifacts:', err);
  }

  return workspaceDir;
}

/**
 * Rewrite original repo paths in a prompt string to their worktree equivalents.
 * Ensures agents directed by their system/initial prompt operate in the isolated
 * worktree rather than the canonical clone.
 */
function rewritePathsForWorktree(prompt: string, repos: TrackRepo[], worktreeRoot: string): string {
  let result = prompt;
  for (const repo of repos) {
    const worktreePath = path.join(worktreeRoot, path.basename(repo.path));
    // Replace with-trailing-slash variant first to avoid partial replacements
    result = result.split(repo.path + '/').join(worktreePath + '/');
    result = result.split(repo.path).join(worktreePath);
  }
  return result;
}

/** Read a repo's .claude/settings.json, returning null if absent or unparseable. */
function readProjectSettings(repoPath: string): ClaudeProjectSettings | null {
  const settingsPath = path.join(repoPath, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return null;
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf-8')) as ClaudeProjectSettings;
  } catch {
    return null;
  }
}

/**
 * Write two workspace-level files after all worktrees are created:
 *
 * 1. .claude/settings.json  — merged permissions and env from all source repos,
 *    so Claude picks up project-level settings even when CWD is the workspace root.
 *
 * 2. workspace.code-workspace — Cursor/VS Code multi-root workspace file,
 *    so editors open each repo as a named root rather than a flat directory.
 *
 * Reads from source repos (repo.path), not worktrees, so the merge always
 * reflects the latest committed project settings.
 * Best-effort — failures are logged but do not block session creation.
 */
function writeWorkspaceArtifacts(workspaceDir: string, repos: TrackRepo[], sessionName?: string, agentsRules?: string | null): void {
  // Plugin rules for AGENTS.md-reading CLIs (Codex, Cursor). The workspace
  // root sits outside the git worktrees, so this can never be committed.
  if (agentsRules) {
    writeFileSync(path.join(workspaceDir, 'AGENTS.md'), agentsRules + '\n', 'utf-8');
    console.log('[worktree] AGENTS.md plugin rules written to workspace root');
  }

  const allowSet = new Set<string>();
  const denySet = new Set<string>();
  const mergedEnv: Record<string, string> = {};

  for (const repo of repos) {
    const settings = readProjectSettings(repo.path);
    if (!settings) continue;
    for (const entry of settings.permissions?.allow ?? []) allowSet.add(entry);
    for (const entry of settings.permissions?.deny ?? []) denySet.add(entry);
    if (settings.env) Object.assign(mergedEnv, settings.env);
  }

  if (allowSet.size > 0 || denySet.size > 0 || Object.keys(mergedEnv).length > 0) {
    const merged: ClaudeProjectSettings = {};
    if (allowSet.size > 0 || denySet.size > 0) {
      merged.permissions = {};
      if (allowSet.size > 0) merged.permissions.allow = [...allowSet].sort();
      if (denySet.size > 0) merged.permissions.deny = [...denySet].sort();
    }
    if (Object.keys(mergedEnv).length > 0) merged.env = mergedEnv;

    const claudeDir = path.join(workspaceDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify(merged, null, 2) + '\n',
      'utf-8',
    );
    console.log(
      `[worktree] workspace settings: ${allowSet.size} allows, ${denySet.size} denies, ${Object.keys(mergedEnv).length} env vars`,
    );
  }

  const folders = repos.map((r) => ({ path: path.basename(r.path), name: path.basename(r.path) }));
  const settings = sessionName
    ? { 'window.title': `\${activeEditorShort}\${separator}${sessionName}\${dirty}` }
    : {};
  const workspaceJson = sessionName
    ? { name: sessionName, folders, settings }
    : { folders, settings };
  writeFileSync(
    path.join(workspaceDir, 'workspace.code-workspace'),
    JSON.stringify(workspaceJson, null, 2) + '\n',
    'utf-8',
  );
  console.log(`[worktree] workspace.code-workspace: ${repos.length} folder(s)`);
}

/**
 * Write a named .code-workspace file for a single-repo session so Cursor
 * shows the session name in the title bar instead of the generic folder name.
 * Uses an absolute folder path since the file lives in the session dir, not
 * inside the repo. Best-effort — failures are logged but do not block session
 * creation.
 */
function writeSingleRootWorkspace(sessionId: string, repoPath: string, sessionName?: string): void {
  const workspaceDir = path.join(SESSION_DATA_DIR, sessionId, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });

  const repoName = path.basename(repoPath);
  const folders = [{ path: repoPath, name: repoName }];
  const settings = sessionName
    ? { 'window.title': `\${activeEditorShort}\${separator}${sessionName}\${dirty}` }
    : {};
  const workspaceJson = sessionName
    ? { name: sessionName, folders, settings }
    : { folders, settings };
  writeFileSync(
    path.join(workspaceDir, 'workspace.code-workspace'),
    JSON.stringify(workspaceJson, null, 2) + '\n',
    'utf-8',
  );
  console.log(`[workspace] single-root workspace.code-workspace: ${sessionName ?? repoName}`);
}

/**
 * Remove worktrees registered in workspace/.worktree-meta.json.
 * Best-effort — directory removal via cleanSessionDir handles the rest.
 */
function cleanupWorktrees(workspaceDir: string): void {
  const metaPath = path.join(workspaceDir, '.worktree-meta.json');
  if (!existsSync(metaPath)) return;

  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as WorktreeMeta;
    for (const repo of meta.repos) {
      const worktreePath = path.join(workspaceDir, repo.name);
      if (!existsSync(worktreePath)) continue;
      try {
        execSync(
          `git -C ${JSON.stringify(repo.path)} worktree remove --force ${JSON.stringify(worktreePath)}`,
          { stdio: 'pipe' },
        );
      } catch {
        // Best-effort — git prune will clean up the ref later
      }
    }
  } catch {
    // Malformed metadata — proceed; directory removal handles files
  }
}

/** djb2 hash — fast, simple, deterministic string→number */
function hashString(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0; // hash * 33 + c
  }
  return hash >>> 0; // unsigned 32-bit
}

export function createTerminalManager(
  sessionRepo: SessionRepository,
  soulLoader?: SoulLoader,
  todoRepo?: TodoRepository,
  pluginRepo?: PluginRepository,
): TerminalManager {
  try {
    execSync('which tmux', { stdio: 'pipe' });
  } catch {
    console.warn('tmux not found in PATH. Terminal sessions will not work.');
  }

  /** Last hash of captured pane content, keyed by session ID */
  const lastPaneHash = new Map<string, number>();

  /** ISO timestamp of last detected activity change, keyed by session ID */
  const lastActivityAt = new Map<string, string>();

  /** Timestamp when we first observed a dead tmux session, keyed by session ID */
  const dyingSince = new Map<string, number>();

  /** Sessions whose background init (worktree + tmux + CLI launch) hasn't
   *  finished. The reaper skips these entirely: tmux may not exist yet, and
   *  the pane shows a transient bare shell before the CLI paints — both would
   *  otherwise trip the dead/exited teardown and kill a session that is merely
   *  still starting up. */
  const initializing = new Set<string>();

  /** Timestamp when a background session's pane first looked like an exited
   *  (bare shell) prompt. Gives the bare-shell retire the same grace as the
   *  dead-tmux path, so a CLI that hasn't painted yet isn't mistaken for one
   *  that exited. */
  const exitedSince = new Map<string, number>();

  /** Current activity status derived from pane detection, keyed by session ID */
  const activityStatusMap = new Map<string, 'working' | 'idle' | 'needs-input'>();

  /** Consecutive sync cycles each session has been observed as idle.
   *  Prevents a single brief clean-state observation (e.g. between thinking
   *  phases) from flipping the orb to idle — requires sustained idle signal. */
  const consecutiveIdleObs = new Map<string, number>();

  /** How many consecutive idle observations are required before we report idle.
   *  At a 30s sync interval this means the session must look idle for ~60s. */
  const IDLE_CONSECUTIVE_THRESHOLD = 2;

  /**
   * Wall-clock timestamp (ms) when a session first reached confirmed idle
   * after having been working. Cleared when the session goes back to working.
   */
  const firstIdledAt = new Map<string, number>();

  /**
   * Sessions that have already been notified for the current idle stretch.
   * Cleared when the session transitions back to working.
   */
  const notifiedIdle = new Set<string>();

  /** How long (ms) a session must stay idle after the working→idle transition
   *  before we emit an idle alert. */
  const IDLE_NOTIFY_DELAY_MS = 30_000;

  /**
   * ISO timestamp of when a session most recently "finished" (confirmed idle
   * or needs-input) and hasn't been viewed since — drives the unread/attention
   * highlight. Cleared once the session goes back to working, or a client
   * attaches to its terminal (see websocket.ts).
   */
  const attentionMap = new Map<string, string>();

  /**
   * Refcount of live terminal viewers per session (maintained by websocket.ts
   * attach/detach). While someone is watching a session, status transitions
   * don't raise the attention highlight — they're seeing it happen.
   */
  const viewerCounts = new Map<string, number>();

  /** Clean all in-memory tracking for a session */
  function clearSessionMaps(sessionId: string): void {
    lastPaneHash.delete(sessionId);
    lastActivityAt.delete(sessionId);
    dyingSince.delete(sessionId);
    exitedSince.delete(sessionId);
    activityStatusMap.delete(sessionId);
    consecutiveIdleObs.delete(sessionId);
    firstIdledAt.delete(sessionId);
    notifiedIdle.delete(sessionId);
    attentionMap.delete(sessionId);
  }

  function getSessionDir(sessionId: string): string {
    const dir = path.join(SESSION_DATA_DIR, sessionId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  function cleanSessionDir(sessionId: string): void {
    const dir = path.join(SESSION_DATA_DIR, sessionId);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Launch an AI CLI inside an existing tmux session */
  async function launchCli(
    session: Session,
    tmuxName: string,
    cwd: string,
    effectiveOptions?: CreateSessionOptions,
  ): Promise<void> {
    const provider = session.provider;
    const sessionDir = getSessionDir(session.id);
    const launcherFile = path.join(sessionDir, 'launch.sh');

    // Inject the plugin registry's enablement map. Done here (not in
    // createSession) so resume/restore re-derive the current registry state
    // on every relaunch. Cheap: one prepared-statement SQLite read.
    if (pluginRepo) {
      try {
        const registered = pluginRepo.findAll();
        if (registered.length > 0) {
          effectiveOptions = { ...(effectiveOptions ?? {}), enabledPlugins: toEnabledPluginsMap(registered) };
        }
      } catch (err) {
        console.warn(`[plugins] Failed to resolve plugin enablement for session ${session.id}:`, err);
      }
    }

    const sessionEnvFile = path.join(process.env.HOME ?? '/tmp', '.workshop', 'session.env');
    const launcherLines = [
      '#!/bin/bash', 'set -e', '',
      `# Load dev credentials if pre-authenticated via scripts/workshop-auth.sh`,
      `if [ -f ${JSON.stringify(sessionEnvFile)} ]; then`,
      `  set -a`,
      `  # shellcheck disable=SC1090`,
      `  source ${JSON.stringify(sessionEnvFile)}`,
      `  set +a`,
      `fi`,
      ``,
    ];

    if (provider === 'codex') {
      buildCodexLauncher(launcherLines, sessionDir, cwd, effectiveOptions);
    } else if (provider === 'gemini') {
      buildGeminiLauncher(launcherLines, sessionDir, cwd, effectiveOptions);
    } else if (provider === 'cursor') {
      buildCursorLauncher(launcherLines, sessionDir, cwd, effectiveOptions);
    } else if (provider === 'claude') {
      buildClaudeLauncher(launcherLines, session.id, sessionDir, tmuxName, cwd, effectiveOptions);
    } else {
      throw new Error(`Unknown session provider: ${provider}`);
    }

    writeFileSync(launcherFile, launcherLines.join('\n') + '\n', 'utf-8');
    chmodSync(launcherFile, 0o755);

    // Wait for the shell to initialise before sending the launcher command.
    // `tmux new-session -d` returns as soon as the session record is created,
    // but the shell inside may not have started yet — especially on WSL where
    // the VFS adds ~300–500 ms of startup latency. A send-keys fired too early
    // is silently dropped. We poll the pane output (up to 5 s) until the shell
    // has produced at least one character (the prompt).
    const shellReadyDeadline = Date.now() + 5000;
    while (Date.now() < shellReadyDeadline) {
      try {
        const pane = execSync(`tmux capture-pane -t ${tmuxName} -p`, {
          stdio: 'pipe',
          encoding: 'utf-8',
          timeout: 1000,
        });
        if (pane.trim().length > 0) break;
      } catch { /* session not visible yet — keep trying */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    execSync(
      `tmux send-keys -t ${tmuxName} ${JSON.stringify(launcherFile)} Enter`,
      { stdio: 'pipe' },
    );

    // Auto-approve the Claude workspace trust dialog from the server process.
    // Running tmux commands here (rather than inside the launcher script's
    // subprocess) avoids WSL socket-access issues where child processes of the
    // tmux pane cannot reach the tmux server. The keys are derived from the
    // pane, not hardcoded: the dialog's cursor defaults to "No, exit", so a
    // blind Enter declines trust and drops the session to a bare shell.
    if (provider === 'claude') {
      const deadline = Date.now() + 30_000;
      const trustTimer = setInterval(() => {
        if (Date.now() > deadline) {
          clearInterval(trustTimer);
          return;
        }
        try {
          const pane = execSync(`tmux capture-pane -t ${tmuxName} -p`, {
            stdio: 'pipe',
            encoding: 'utf-8',
            timeout: 2000,
          });
          const key = trustDialogKey(pane);
          if (key) {
            execSync(`tmux send-keys -t ${tmuxName} ${key}`, { stdio: 'pipe' });
            // `Down` only moves the cursor — keep polling until it lands on the
            // trust option and we can confirm with Enter.
            if (key === 'Enter') clearInterval(trustTimer);
          }
        } catch {
          // tmux session not ready yet or already gone — keep trying until deadline
        }
      }, 500);
    }

    // For non-Claude providers, use the tmux paste helper to deliver the
    // initial prompt after the TUI is ready. Claude handles this via
    // positional argument in the launch script (no race condition).
    if (
      effectiveOptions?.initialPrompt &&
      provider !== 'claude' &&
      provider !== 'cursor'
    ) {
      sendInitialPrompt(sessionDir, tmuxName, provider);
    }
  }

  return {
    async createSession(trackId: TrackId, options?: CreateSessionOptions): Promise<Session> {
      const provider = options?.provider || 'claude';
      const tmuxName = `workshop-${uuid().slice(0, 8)}`;

      // Prepend soul to system prompt
      let systemPrompt = options?.systemPrompt || '';
      if (soulLoader) {
        const soul = soulLoader.load();
        if (soul) {
          systemPrompt = systemPrompt
            ? soul + '\n\n---\n\n' + systemPrompt
            : soul;
        }
      }

      // Create DB record first — we need session.id for the worktree path.
      // This is the only synchronous work; everything else runs in the background
      // so the HTTP response is not held hostage by git fetch / worktree checkout.
      const session = sessionRepo.create({
        trackId,
        tmuxSession: tmuxName,
        name: options?.name,
        systemPrompt: systemPrompt || undefined,
        state: 'active',
        provider,
        background: options?.background ?? false,
        workingDirectory: options?.workingDirectory || process.env.HOME || '/tmp',
      });

      // Background init — worktree creation (slow), tmux, CLI launch. Not awaited.
      // The caller receives the session record immediately and can respond to the
      // HTTP client; the terminal becomes usable once this resolves. The reaper
      // skips the session until this settles (see `initializing`).
      initializing.add(session.id);
      const initPromise = (async () => {
        let cwd = options?.workingDirectory || process.env.HOME || '/tmp';
        let resolvedSystemPrompt = systemPrompt;
        let initialPrompt = options?.initialPrompt;

        if (options?.worktreeMode && options.repos?.length) {
          try {
            // Rules payload for AGENTS.md-reading CLIs (Codex/Cursor), read
            // from the locally synced plugin clones — no network here.
            let agentsRules: string | null = null;
            if (pluginRepo) {
              try {
                agentsRules = readAgentsRules(pluginRepo.findAll().filter((p) => p.enabled && p.providers?.cursor));
              } catch (err) {
                console.warn(`[plugins] Failed to read plugin rules for session ${session.id}:`, err);
              }
            }
            const worktreeRoot = await createWorktrees(
              session.id, options.repos, options.name, options.issueKey, agentsRules,
            );
            sessionRepo.updateWorktreeRoot(session.id, worktreeRoot);
            session.worktreeRoot = worktreeRoot;
            // If there's only one repo, drop directly into it — no reason to sit
            // in the workspace root when there's nothing else to navigate around.
            cwd = options.repos.length === 1
              ? path.join(worktreeRoot, path.basename(options.repos[0].path))
              : worktreeRoot;
            sessionRepo.updateWorkingDirectory(session.id, cwd);
            session.workingDirectory = cwd;

            // Rewrite any original repo paths in prompts to point at the worktree
            // so agents don't wander back to the canonical clone.
            if (resolvedSystemPrompt) {
              resolvedSystemPrompt = rewritePathsForWorktree(resolvedSystemPrompt, options.repos, worktreeRoot);
            }
            if (initialPrompt) {
              initialPrompt = rewritePathsForWorktree(initialPrompt, options.repos, worktreeRoot);
            }
          } catch (err) {
            console.warn(`[worktree] Failed to create worktrees for session ${session.id}:`, err);
            // Fall back to standard workingDirectory
          }
        } else if (options?.workingDirectory) {
          // Single-repo session: write a named workspace file so Cursor shows the
          // session name in the title bar. Does not create git worktrees or change
          // the Claude CWD — purely for the editor open action.
          try {
            writeSingleRootWorkspace(session.id, options.workingDirectory, options.name);
          } catch (err) {
            console.warn(`[workspace] Failed to write single-root workspace for session ${session.id}:`, err);
          }
        }

        const effectiveOptions: CreateSessionOptions | undefined = options
          ? { ...options, systemPrompt: resolvedSystemPrompt || undefined, initialPrompt }
          : resolvedSystemPrompt
            ? { systemPrompt: resolvedSystemPrompt }
            : undefined;

        const cleanEnv = { ...process.env };
        delete cleanEnv.CLAUDECODE;

        execSync(
          `tmux new-session -d -s ${tmuxName} ${NIX_CLEAN_TMUX_FLAGS} ${TMUX_PATH_FLAG} -x 120 -y 40 -c ${JSON.stringify(cwd)}`,
          { stdio: 'pipe', env: cleanEnv },
        );
        configureTmuxSession(tmuxName);

        if (!options?.skipClaude) {
          await launchCli(session, tmuxName, cwd, effectiveOptions);
        }

        options?.onReady?.(session);
      })();

      initPromise
        .catch((err) => {
          console.error(`[session] Background init failed for ${session.id}:`, err);
          try { options?.onReady?.(session); } catch { /* ignore */ }
        })
        .finally(() => { initializing.delete(session.id); });

      return session;
    },

    async destroySession(sessionId: SessionId): Promise<void> {
      const session = sessionRepo.findById(sessionId);
      if (!session) return;

      // Clean up git worktrees before removing the session directory
      if (session.worktreeRoot) {
        cleanupWorktrees(session.worktreeRoot);
      }

      try {
        execSync(`tmux kill-session -t ${session.tmuxSession}`, { stdio: 'pipe' });
      } catch {
        // Session might already be dead
      }

      cleanSessionDir(sessionId);
      sessionRepo.delete(sessionId);
      clearSessionMaps(sessionId);
    },

    async softDeleteSession(sessionId: SessionId): Promise<void> {
      const session = sessionRepo.findById(sessionId);
      if (!session) return;

      // Capture tmux scrollback before killing — preserves output for the recycle bin viewer.
      try {
        const raw = execSync(`tmux capture-pane -t ${session.tmuxSession} -p -S -`, {
          stdio: 'pipe', encoding: 'utf-8', timeout: 5000,
        });
        if (raw.trim()) {
          const lines = raw.split('\n');
          const maxLines = 500;
          const content = lines.length > maxLines
            ? [`[... ${lines.length - maxLines} earlier lines omitted ...]`, ...lines.slice(-maxLines)].join('\n')
            : raw;
          const sessionDir = path.join(SESSION_DATA_DIR, sessionId);
          mkdirSync(sessionDir, { recursive: true });
          writeFileSync(path.join(sessionDir, 'output.txt'), content.trimEnd() + '\n', 'utf-8');
        }
      } catch {
        // Non-fatal — tmux may already be gone
      }

      // Kill the tmux process — the worktree and session dir are preserved for recovery.
      try {
        execSync(`tmux kill-session -t ${session.tmuxSession}`, { stdio: 'pipe' });
      } catch {
        // Already dead — fine
      }

      sessionRepo.softDelete(sessionId);
      clearSessionMaps(sessionId);
    },

    purgeExpiredSessions(retentionDays = 7): number {
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
      const expired = sessionRepo.findAllDeleted().filter((s) => s.deletedAt && s.deletedAt < cutoff);

      for (const session of expired) {
        if (session.worktreeRoot) {
          cleanupWorktrees(session.worktreeRoot);
        }
        cleanSessionDir(session.id);
        sessionRepo.delete(session.id);
        clearSessionMaps(session.id);
      }

      if (expired.length > 0) {
        console.log(`[recycle-bin] Purged ${expired.length} expired session(s)`);
      }

      return expired.length;
    },

    isSessionAlive(session: Session): boolean {
      try {
        execSync(`tmux has-session -t ${session.tmuxSession}`, { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },

    async sendInput(sessionId: SessionId, text: string): Promise<boolean> {
      const session = sessionRepo.findById(sessionId);
      if (!session || !this.isSessionAlive(session)) return false;

      const bufName = `ws-input-${sessionId}`;

      try {
        // Pipe text straight to tmux's buffer via stdin — no temp file to leave behind.
        execFileSync('tmux', ['load-buffer', '-b', bufName, '-'], { input: text, stdio: 'pipe' });
        execFileSync('tmux', ['paste-buffer', '-t', session.tmuxSession, '-b', bufName, '-d'], { stdio: 'pipe' });
        // Let the TUI ingest the (possibly multi-line) paste before the submitting
        // Enter — otherwise Enter can race the paste and split the message. Async so
        // the delay never blocks the event loop (WebSocket terminal streaming etc.).
        await new Promise((resolve) => setTimeout(resolve, 400));
        execFileSync('tmux', ['send-keys', '-t', session.tmuxSession, 'Enter'], { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },

    getLastActivityAt(sessionId: SessionId): string | undefined {
      return lastActivityAt.get(sessionId);
    },

    isDying(sessionId: SessionId): boolean {
      return dyingSince.has(sessionId);
    },

    getActivityStatus(sessionId: SessionId): 'working' | 'idle' | 'needs-input' | undefined {
      return activityStatusMap.get(sessionId);
    },

    getAttentionSince(sessionId: SessionId): string | undefined {
      return attentionMap.get(sessionId);
    },

    clearAttention(sessionId: SessionId): boolean {
      return attentionMap.delete(sessionId);
    },

    viewerAttached(sessionId: SessionId): void {
      viewerCounts.set(sessionId, (viewerCounts.get(sessionId) ?? 0) + 1);
    },

    viewerDetached(sessionId: SessionId): void {
      const next = (viewerCounts.get(sessionId) ?? 0) - 1;
      if (next > 0) viewerCounts.set(sessionId, next);
      else viewerCounts.delete(sessionId);
    },

    syncSessionStates(): SyncResult {
      const allSessions = sessionRepo.findAll();
      const cleaned: SyncResult['cleaned'] = [];
      const suspended: SyncResult['suspended'] = [];
      const dying: SyncResult['dying'] = [];
      const activityChangedSet = new Set<TrackId>();
      const idleAlerts: SyncResult['idleAlerts'] = [];
      const needsInputAlerts: SyncResult['needsInputAlerts'] = [];

      /** Reap a session: kill tmux, clean up files, remove from DB */
      const reap = (session: Session, reason: string) => {
        console.log(
          `Session sync: reaping ${session.id} (${session.tmuxSession}) — ${reason}`,
        );
        try {
          execSync(`tmux kill-session -t ${session.tmuxSession}`, { stdio: 'pipe' });
        } catch { /* already dead */ }
        cleanSessionDir(session.id);
        sessionRepo.delete(session.id);
        clearSessionMaps(session.id);
        cleaned.push({ sessionId: session.id, trackId: session.trackId });
      };

      /** Retire a session: kill tmux, soft-delete into recycle bin (session dir preserved) */
      const retire = (session: Session, reason: string) => {
        console.log(
          `Session sync: retiring ${session.id} (${session.tmuxSession}) — ${reason}`,
        );
        try {
          execSync(`tmux kill-session -t ${session.tmuxSession}`, { stdio: 'pipe' });
        } catch { /* already dead */ }
        sessionRepo.softDelete(session.id);
        clearSessionMaps(session.id);
        cleaned.push({ sessionId: session.id, trackId: session.trackId });
      };

      /** Suspend a session: keep the DB record for later --resume */
      const suspend = (session: Session, reason: string) => {
        console.log(
          `Session sync: suspending ${session.id} (resume: ${session.claudeResumeId}) — ${reason}`,
        );
        sessionRepo.updateState(session.id, 'suspended');
        clearSessionMaps(session.id);
        suspended.push({ sessionId: session.id, trackId: session.trackId });
      };

      for (const session of allSessions) {
        // Already suspended — leave alone (resumeSuspendedSessions handles these)
        if (session.state === 'suspended') continue;

        // Still coming up — worktree/tmux/CLI launch in flight. tmux may not
        // exist yet and the pane shows a transient bare shell before the CLI
        // paints; don't reap/retire until init finishes.
        if (initializing.has(session.id)) continue;

        const alive = this.isSessionAlive(session);

        // 1. tmux session is gone — dying grace period before reap/suspend
        if (!alive && session.state !== 'dead') {
          const now = Date.now();
          const deathStart = dyingSince.get(session.id);

          if (!deathStart) {
            // First observation — start the grace period
            dyingSince.set(session.id, now);
            dying.push({ sessionId: session.id, trackId: session.trackId });
            continue;
          }

          if (now - deathStart < DYING_GRACE_PERIOD_MS) {
            // Still within grace period
            dying.push({ sessionId: session.id, trackId: session.trackId });
            continue;
          }

          // Grace period expired — suspend (resumable) or retire to recycle bin
          if (session.claudeResumeId && session.provider === 'claude') {
            suspend(session, 'tmux session dead (resumable)');
          } else {
            retire(session, 'tmux session dead');
          }
          continue;
        }

        // tmux came back alive — clear dying state
        if (alive && dyingSince.has(session.id)) {
          dyingSince.delete(session.id);
        }

        // 2. Marked dead in DB but tmux is still alive — resurrect
        if (alive && session.state === 'dead') {
          sessionRepo.updateState(session.id, 'active');
          continue;
        }

        // Skip non-alive sessions from here on
        if (!alive) continue;

        // --- Shared pane capture for alive sessions ---
        const capturedLines = capturePaneLines(session.tmuxSession, 20);

        // Activity hash comparison
        const contentStr = capturedLines.join('\n');
        const currentHash = hashString(contentStr);
        const previousHash = lastPaneHash.get(session.id);

        if (previousHash === undefined || currentHash !== previousHash) {
          lastPaneHash.set(session.id, currentHash);
          lastActivityAt.set(session.id, new Date().toISOString());
          activityChangedSet.add(session.trackId);
        }

        // --- Activity status tracking (all alive sessions) ---
        // needs-input takes priority: check before idle to catch question prompts
        const prevStatus = activityStatusMap.get(session.id);
        if (isSessionNeedsInput(session, capturedLines)) {
          consecutiveIdleObs.delete(session.id);
          firstIdledAt.delete(session.id);
          notifiedIdle.delete(session.id);
          if (prevStatus !== 'needs-input' && !viewerCounts.has(session.id)) {
            attentionMap.set(session.id, new Date().toISOString());
          }
          // Skip the first observation (prevStatus undefined, e.g. server restart) to avoid a notification burst.
          if (prevStatus !== undefined && prevStatus !== 'needs-input') {
            needsInputAlerts.push({
              sessionId: session.id,
              trackId: session.trackId,
              sessionName: session.name ?? undefined,
            });
          }
          activityStatusMap.set(session.id, 'needs-input');
        } else if (isSessionIdle(session, capturedLines)) {
          // Require IDLE_CONSECUTIVE_THRESHOLD consecutive idle observations
          // before reporting idle. This prevents brief clean-state windows
          // (e.g. the moment between a thinking phase and the next tool call)
          // from flipping the orb to yellow for a full sync interval.
          const count = (consecutiveIdleObs.get(session.id) ?? 0) + 1;
          consecutiveIdleObs.set(session.id, count);
          if (count >= IDLE_CONSECUTIVE_THRESHOLD) {
            // Raise the attention highlight only on a genuine transition into idle
            // (prevStatus was 'working' or 'needs-input') — not on the very first
            // observation of a session that's already idle (e.g. server restart
            // pickup), which mirrors how firstIdledAt/notifiedIdle avoid alerting.
            if (prevStatus !== undefined && prevStatus !== 'idle' && !viewerCounts.has(session.id)) {
              attentionMap.set(session.id, new Date().toISOString());
            }
            activityStatusMap.set(session.id, 'idle');
            // Record when this working→idle transition first became confirmed idle.
            // Only set on the first confirmation after being in working state.
            if (prevStatus === 'working' && !firstIdledAt.has(session.id)) {
              firstIdledAt.set(session.id, Date.now());
            }
            // Emit alert once the session has been idle long enough.
            const idledAt = firstIdledAt.get(session.id);
            if (idledAt !== undefined && Date.now() - idledAt >= IDLE_NOTIFY_DELAY_MS && !notifiedIdle.has(session.id)) {
              notifiedIdle.add(session.id);
              idleAlerts.push({
                sessionId: session.id,
                trackId: session.trackId,
                sessionName: session.name ?? undefined,
              });
            }
          }
          // If below threshold, leave the current status in place (working or
          // undefined) — it will transition once the signal is sustained.
        } else {
          // Actively working — reset debounce counter and update lastActivityAt
          // so the office view stays awake even when pane content is unchanged
          // (e.g. a long-running tool call with no new output lines).
          const wasIdle = activityStatusMap.get(session.id) !== 'working';
          if (wasIdle) {
            lastActivityAt.set(session.id, new Date().toISOString());
            activityChangedSet.add(session.trackId);
          }
          consecutiveIdleObs.delete(session.id);
          firstIdledAt.delete(session.id);
          notifiedIdle.delete(session.id);
          attentionMap.delete(session.id);
          activityStatusMap.set(session.id, 'working');
        }

        // Broadcast status transitions even when pane content didn't change —
        // the debounce-confirmed idle flip typically lands on a hash-stable
        // cycle, and clients need the session:updated push to show the new
        // status/attention highlight promptly.
        if (activityStatusMap.get(session.id) !== prevStatus) {
          activityChangedSet.add(session.trackId);
        }

        // --- Background session cleanup ---
        if (session.background) {
          // Background session not logged in — retire to recycle bin
          if (isSessionLoggedOut(session, capturedLines)) {
            retire(session, 'background: Claude not logged in');
            continue;
          }

          // Background CLI exited (bare shell prompt) — retire to recycle bin.
          // Require the bare shell to persist a grace window first: a just-
          // launched CLI shows a bare prompt for a second or two before it
          // paints, and retiring in that gap kills a healthy session.
          if (isSessionExited(session, capturedLines)) {
            const since = exitedSince.get(session.id);
            if (since === undefined) {
              exitedSince.set(session.id, Date.now());
              continue;
            }
            if (Date.now() - since < DYING_GRACE_PERIOD_MS) continue;
            retire(session, 'background: CLI exited (bare shell prompt)');
            continue;
          }
          exitedSince.delete(session.id);
        }
        // All sessions (background or interactive) are otherwise left alone
      }

      if (cleaned.length > 0) {
        console.log(`Session sync: cleaned up ${cleaned.length} dead/idle session(s)`);
      }
      if (suspended.length > 0) {
        console.log(`Session sync: suspended ${suspended.length} resumable session(s)`);
      }
      if (idleAlerts.length > 0) {
        for (const alert of idleAlerts) {
          console.log(`[idle-alert] Session ${alert.sessionId} (${alert.sessionName ?? 'unnamed'}) has been idle for ${IDLE_NOTIFY_DELAY_MS / 1000}s`);
        }
      }
      return { cleaned, suspended, dying, activityChanged: [...activityChangedSet], idleAlerts, needsInputAlerts };
    },

    async resumeSuspendedSessions(): Promise<Session[]> {
      const allSessions = sessionRepo.findAll();
      const suspendedSessions = allSessions.filter(
        (s) => s.state === 'suspended' && s.claudeResumeId && s.provider === 'claude',
      );

      if (suspendedSessions.length === 0) return [];

      console.log(`Resuming ${suspendedSessions.length} suspended session(s)...`);
      const resumed: Session[] = [];

      for (const session of suspendedSessions) {
        try {
          const tmuxName = `workshop-${uuid().slice(0, 8)}`;
          // Restore the original CWD so Claude finds the conversation in the right project bucket.
          // workingDirectory is always the exact directory Claude launched from (e.g. workspace/repo
          // for single-repo worktree sessions). worktreeRoot is the parent workspace directory and
          // is less specific — prefer workingDirectory so Claude finds the correct project bucket.
          const cwd = session.workingDirectory || session.worktreeRoot || process.env.HOME || '/tmp';

          const cleanEnv = { ...process.env };
          delete cleanEnv.CLAUDECODE;

          execSync(
            `tmux new-session -d -s ${tmuxName} ${NIX_CLEAN_TMUX_FLAGS} ${TMUX_PATH_FLAG} -x 120 -y 40 -c ${JSON.stringify(cwd)}`,
            { stdio: 'pipe', env: cleanEnv },
          );
          configureTmuxSession(tmuxName);

          // Update the tmux session name and reactivate
          sessionRepo.updateTmuxSession(session.id, tmuxName);
          sessionRepo.updateState(session.id, 'active');

          // Build a fresh session object with updated fields
          const updatedSession: Session = {
            ...session,
            tmuxSession: tmuxName,
            state: 'active',
          };

          // Launch Claude with --resume
          await launchCli(updatedSession, tmuxName, cwd, {
            claudeResumeId: session.claudeResumeId,
            background: session.background,
          });

          console.log(
            `Resumed session ${session.id} → ${tmuxName} (claude --resume ${session.claudeResumeId})`,
          );
          resumed.push(updatedSession);
        } catch (err) {
          console.error(`Failed to resume session ${session.id}:`, err);
          // Mark as dead rather than leaving in suspended limbo
          sessionRepo.updateState(session.id, 'dead');
        }
      }

      return resumed;
    },

    async restoreSession(sessionId: SessionId): Promise<Session> {
      // Pull the deleted record (findById sees deleted rows)
      const session = sessionRepo.findById(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      const tmuxName = `workshop-${uuid().slice(0, 8)}`;
      // Prefer workingDirectory (the exact dir Claude launched from, e.g. workspace/repo for
      // single-repo worktree sessions) over worktreeRoot (the parent workspace dir).
      // Using worktreeRoot would send Claude to the wrong project bucket and produce
      // "No conversation found" errors on resume.
      const cwd = session.workingDirectory || session.worktreeRoot || process.env.HOME || '/tmp';

      const cleanEnv = { ...process.env };
      delete cleanEnv.CLAUDECODE;

      execSync(
        `tmux new-session -d -s ${tmuxName} ${NIX_CLEAN_TMUX_FLAGS} ${TMUX_PATH_FLAG} -x 120 -y 40 -c ${JSON.stringify(cwd)}`,
        { stdio: 'pipe', env: cleanEnv },
      );
      configureTmuxSession(tmuxName);

      // Restore the DB record first so the session is visible again
      sessionRepo.restore(sessionId);
      sessionRepo.updateTmuxSession(sessionId, tmuxName);
      sessionRepo.updateState(sessionId, 'active');

      const restoredSession: Session = {
        ...session,
        tmuxSession: tmuxName,
        state: 'active',
        deletedAt: undefined,
      };

      if (session.claudeResumeId && session.provider === 'claude') {
        // Re-launch Claude picking up the prior conversation
        await launchCli(restoredSession, tmuxName, cwd, {
          claudeResumeId: session.claudeResumeId,
          background: session.background,
        });
        console.log(
          `[restore] Session ${sessionId} → ${tmuxName} (claude --resume ${session.claudeResumeId})`,
        );
      } else {
        // No resume ID — just provide a shell at the original CWD
        console.log(`[restore] Session ${sessionId} → ${tmuxName} (bare shell, cwd: ${cwd})`);
      }

      return restoredSession;
    },
  };
}
