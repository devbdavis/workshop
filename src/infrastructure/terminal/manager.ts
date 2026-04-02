import { execSync } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync, chmodSync, symlinkSync } from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type { SessionRepository } from '@domain/session/repository';
import type { Session, SessionId, TrackId, TrackRepo } from '@foundation/types';
import type { SoulLoader } from '@infrastructure/soul/soul-loader.js';
import type { TodoRepository } from '@domain/todo/repository.js';
import {
  capturePaneLines, isSessionIdle, isSessionNeedsInput, isSessionLoggedOut, isSessionExited,
} from './pane-detection.js';
import {
  buildClaudeLauncher, buildGeminiLauncher, buildCodexLauncher,
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

/** Seconds a dead tmux session gets before being reaped/suspended */
const DYING_GRACE_PERIOD_MS = 30_000;

/** Cache dirs to symlink from the canonical clone into each worktree */
const WORKTREE_SYMLINK_DIRS = ['node_modules', '.venv'];

interface WorktreeMeta {
  repos: Array<{ path: string; name: string }>;
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
  return issueKey ? `${base}-${issueKey}` : base;
}

/**
 * Fetch origin and return the remote-tracking ref for its HEAD branch (e.g. "origin/main").
 * Returns undefined if the repo has no remote or the ref cannot be determined — callers
 * fall back to creating the worktree from the current HEAD.
 */
function fetchAndResolveBase(repoPath: string): string | undefined {
  try {
    execSync(`git -C ${JSON.stringify(repoPath)} fetch origin --quiet`, { stdio: 'pipe' });
  } catch (err) {
    // Log so the failure is visible in server output — but don't bail; we can
    // still create the worktree from whatever remote-tracking ref exists locally.
    console.warn(
      `[worktree] git fetch origin failed for ${repoPath}:`,
      err instanceof Error ? err.message.trim() : err,
    );
  }

  // Derive the remote ref from the local HEAD's branch name — the canonical clone
  // always knows which branch it's on, and fetch just updated origin/<branch>.
  try {
    const localBranch = execSync(
      `git -C ${JSON.stringify(repoPath)} rev-parse --abbrev-ref HEAD`,
      { stdio: 'pipe' },
    ).toString().trim(); // e.g. "main"

    if (localBranch && localBranch !== 'HEAD') {
      const remoteRef = `origin/${localBranch}`;
      // Verify the ref actually exists before handing it to worktree add
      execSync(
        `git -C ${JSON.stringify(repoPath)} rev-parse --verify ${JSON.stringify(remoteRef)}`,
        { stdio: 'pipe' },
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
 * Returns the workspace path. Throws on failure (caller should handle gracefully).
 */
function createWorktrees(sessionId: string, repos: TrackRepo[], sessionName?: string, issueKey?: string): string {
  const workspaceDir = path.join(SESSION_DATA_DIR, sessionId, 'workspace');
  mkdirSync(workspaceDir, { recursive: true });

  const branch = worktreeBranchName(sessionName, sessionId, issueKey);

  for (const repo of repos) {
    const repoName = path.basename(repo.path);
    const worktreePath = path.join(workspaceDir, repoName);

    const base = fetchAndResolveBase(repo.path);
    const startPoint = base ? ` ${JSON.stringify(base)}` : '';
    execSync(
      `git -C ${JSON.stringify(repo.path)} worktree add ${JSON.stringify(worktreePath)} -b ${JSON.stringify(branch)}${startPoint}`,
      { stdio: 'pipe' },
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
  }

  // Write metadata so cleanup can locate the original repo paths
  const meta: WorktreeMeta = {
    repos: repos.map((r) => ({ path: r.path, name: path.basename(r.path) })),
  };
  writeFileSync(path.join(workspaceDir, '.worktree-meta.json'), JSON.stringify(meta), 'utf-8');

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

export function createTerminalManager(sessionRepo: SessionRepository, soulLoader?: SoulLoader, todoRepo?: TodoRepository): TerminalManager {
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

  /** Current activity status derived from pane detection, keyed by session ID */
  const activityStatusMap = new Map<string, 'working' | 'idle' | 'needs-input'>();

  /** Consecutive sync cycles each session has been observed as idle.
   *  Prevents a single brief clean-state observation (e.g. between thinking
   *  phases) from flipping the orb to idle — requires sustained idle signal. */
  const consecutiveIdleObs = new Map<string, number>();

  /** How many consecutive idle observations are required before we report idle.
   *  At a 30s sync interval this means the session must look idle for ~60s. */
  const IDLE_CONSECUTIVE_THRESHOLD = 2;

  /** Clean all in-memory tracking for a session */
  function clearSessionMaps(sessionId: string): void {
    lastPaneHash.delete(sessionId);
    lastActivityAt.delete(sessionId);
    dyingSince.delete(sessionId);
    activityStatusMap.delete(sessionId);
    consecutiveIdleObs.delete(sessionId);
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
  function launchCli(
    session: Session,
    tmuxName: string,
    cwd: string,
    effectiveOptions?: CreateSessionOptions,
  ): void {
    const provider = session.provider;
    const sessionDir = getSessionDir(session.id);
    const launcherFile = path.join(sessionDir, 'launch.sh');
    const launcherLines = ['#!/bin/bash', 'set -e', ''];

    if (provider === 'codex') {
      buildCodexLauncher(launcherLines, sessionDir, cwd, effectiveOptions);
    } else if (provider === 'gemini') {
      buildGeminiLauncher(launcherLines, sessionDir, cwd, effectiveOptions);
    } else if (provider === 'claude') {
      buildClaudeLauncher(launcherLines, session.id, sessionDir, tmuxName, cwd, effectiveOptions);
    } else {
      throw new Error(`Unknown session provider: ${provider}`);
    }

    writeFileSync(launcherFile, launcherLines.join('\n') + '\n', 'utf-8');
    chmodSync(launcherFile, 0o755);

    execSync(
      `tmux send-keys -t ${tmuxName} ${JSON.stringify(launcherFile)} Enter`,
      { stdio: 'pipe' },
    );

    // For non-Claude providers, use the tmux paste helper to deliver the
    // initial prompt after the TUI is ready. Claude handles this via
    // positional argument in the launch script (no race condition).
    if (effectiveOptions?.initialPrompt && provider !== 'claude') {
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
      // workingDirectory is recorded now (before worktree override below) so we
      // have the pre-worktree fallback; it will be overwritten after worktree creation.
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

      // Create worktrees if requested
      let cwd = options?.workingDirectory || process.env.HOME || '/tmp';
      let initialPrompt = options?.initialPrompt;
      if (options?.worktreeMode && options.repos?.length) {
        try {
          const worktreeRoot = createWorktrees(session.id, options.repos, options.name, options.issueKey);
          sessionRepo.updateWorktreeRoot(session.id, worktreeRoot);
          session.worktreeRoot = worktreeRoot;
          cwd = worktreeRoot;

          // Rewrite any original repo paths in prompts to point at the worktree
          // so agents don't wander back to the canonical clone.
          if (systemPrompt) {
            systemPrompt = rewritePathsForWorktree(systemPrompt, options.repos, worktreeRoot);
          }
          if (initialPrompt) {
            initialPrompt = rewritePathsForWorktree(initialPrompt, options.repos, worktreeRoot);
          }
        } catch (err) {
          console.warn(`[worktree] Failed to create worktrees for session ${session.id}:`, err);
          // Fall back to standard workingDirectory
        }
      }

      // Create modified options with soul-prepended system prompt (and rewritten paths if worktree)
      const effectiveOptions: CreateSessionOptions | undefined = options
        ? { ...options, systemPrompt: systemPrompt || undefined, initialPrompt }
        : systemPrompt
          ? { systemPrompt }
          : undefined;

      const cleanEnv = { ...process.env };
      delete cleanEnv.CLAUDECODE;

      execSync(
        `tmux new-session -d -s ${tmuxName} -x 120 -y 40 -c ${JSON.stringify(cwd)}`,
        { stdio: 'pipe', env: cleanEnv },
      );

      if (!options?.skipClaude) {
        launchCli(session, tmuxName, cwd, effectiveOptions);
      }

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

    getLastActivityAt(sessionId: SessionId): string | undefined {
      return lastActivityAt.get(sessionId);
    },

    isDying(sessionId: SessionId): boolean {
      return dyingSince.has(sessionId);
    },

    getActivityStatus(sessionId: SessionId): 'working' | 'idle' | 'needs-input' | undefined {
      return activityStatusMap.get(sessionId);
    },

    syncSessionStates(): SyncResult {
      const allSessions = sessionRepo.findAll();
      const cleaned: SyncResult['cleaned'] = [];
      const suspended: SyncResult['suspended'] = [];
      const dying: SyncResult['dying'] = [];
      const activityChangedSet = new Set<TrackId>();

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

          // Grace period expired — reap or suspend
          if (session.claudeResumeId && session.provider === 'claude') {
            suspend(session, 'tmux session dead (resumable)');
          } else {
            reap(session, 'tmux session dead');
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
        if (isSessionNeedsInput(session, capturedLines)) {
          consecutiveIdleObs.delete(session.id);
          activityStatusMap.set(session.id, 'needs-input');
        } else if (isSessionIdle(session, capturedLines)) {
          // Require IDLE_CONSECUTIVE_THRESHOLD consecutive idle observations
          // before reporting idle. This prevents brief clean-state windows
          // (e.g. the moment between a thinking phase and the next tool call)
          // from flipping the orb to yellow for a full sync interval.
          const count = (consecutiveIdleObs.get(session.id) ?? 0) + 1;
          consecutiveIdleObs.set(session.id, count);
          if (count >= IDLE_CONSECUTIVE_THRESHOLD) {
            activityStatusMap.set(session.id, 'idle');
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
          activityStatusMap.set(session.id, 'working');
        }

        // --- Background session cleanup ---
        if (session.background) {
          // Background session not logged in — reap immediately
          if (isSessionLoggedOut(session, capturedLines)) {
            reap(session, 'background: Claude not logged in');
            continue;
          }

          // Background CLI exited (bare shell prompt) — reap immediately
          if (isSessionExited(session, capturedLines)) {
            reap(session, 'background: CLI exited (bare shell prompt)');
            continue;
          }
        }
        // All sessions (background or interactive) are otherwise left alone
      }

      if (cleaned.length > 0) {
        console.log(`Session sync: cleaned up ${cleaned.length} dead/idle session(s)`);
      }
      if (suspended.length > 0) {
        console.log(`Session sync: suspended ${suspended.length} resumable session(s)`);
      }
      return { cleaned, suspended, dying, activityChanged: [...activityChangedSet] };
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
          // Worktree sessions use worktreeRoot (most specific); others use the stored workingDirectory.
          const cwd = session.worktreeRoot || session.workingDirectory || process.env.HOME || '/tmp';

          const cleanEnv = { ...process.env };
          delete cleanEnv.CLAUDECODE;

          execSync(
            `tmux new-session -d -s ${tmuxName} -x 120 -y 40 -c ${JSON.stringify(cwd)}`,
            { stdio: 'pipe', env: cleanEnv },
          );

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
          launchCli(updatedSession, tmuxName, cwd, {
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
      // Prefer worktreeRoot so Claude finds the conversation in the right
      // project bucket; fall back through workingDirectory to HOME.
      const cwd = session.worktreeRoot || session.workingDirectory || process.env.HOME || '/tmp';

      const cleanEnv = { ...process.env };
      delete cleanEnv.CLAUDECODE;

      execSync(
        `tmux new-session -d -s ${tmuxName} -x 120 -y 40 -c ${JSON.stringify(cwd)}`,
        { stdio: 'pipe', env: cleanEnv },
      );

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
        launchCli(restoredSession, tmuxName, cwd, {
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
