import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync, chmodSync } from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type { SessionRepository } from '@domain/session/repository';
import type { Session, SessionId, TrackId } from '@foundation/types';
import type { SoulLoader } from '@infrastructure/soul/soul-loader.js';
import {
  capturePaneLines, isSessionIdle, isSessionLoggedOut, isSessionExited,
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

/** Minutes a background session can sit idle at the CLI prompt before being reaped.
 *  Set to 15m to give workflow agents time to complete MCP tool calls and
 *  transition tickets before being reaped. Previous value of 5m caused a
 *  seven-verification loop where agents completed work but got reaped
 *  before they could call transition_ticket. */
const BACKGROUND_IDLE_TIMEOUT_MINUTES = 15;

/** Seconds a dead tmux session gets before being reaped/suspended */
const DYING_GRACE_PERIOD_MS = 30_000;

/** djb2 hash — fast, simple, deterministic string→number */
function hashString(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0; // hash * 33 + c
  }
  return hash >>> 0; // unsigned 32-bit
}

export function createTerminalManager(sessionRepo: SessionRepository, soulLoader?: SoulLoader): TerminalManager {
  try {
    execSync('which tmux', { stdio: 'pipe' });
  } catch {
    console.warn('tmux not found in PATH. Terminal sessions will not work.');
  }

  /** Track when we first observe a session idle, keyed by session ID */
  const idleFirstSeen = new Map<string, number>();

  /** Last hash of captured pane content, keyed by session ID */
  const lastPaneHash = new Map<string, number>();

  /** ISO timestamp of last detected activity change, keyed by session ID */
  const lastActivityAt = new Map<string, string>();

  /** Timestamp when we first observed a dead tmux session, keyed by session ID */
  const dyingSince = new Map<string, number>();

  /** Get how many minutes a session has been observed idle */
  function getIdleMinutes(session: Session): number {
    const firstSeen = idleFirstSeen.get(session.id);
    if (!firstSeen) {
      idleFirstSeen.set(session.id, Date.now());
      return 0;
    }
    return (Date.now() - firstSeen) / 60_000;
  }

  /** Clean all in-memory tracking for a session */
  function clearSessionMaps(sessionId: string): void {
    idleFirstSeen.delete(sessionId);
    lastPaneHash.delete(sessionId);
    lastActivityAt.delete(sessionId);
    dyingSince.delete(sessionId);
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
      buildClaudeLauncher(launcherLines, session.id, sessionDir, tmuxName, effectiveOptions);
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
      const cwd = options?.workingDirectory || process.env.HOME || '/tmp';

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

      // Create modified options with soul-prepended system prompt
      const effectiveOptions: CreateSessionOptions | undefined = options
        ? { ...options, systemPrompt: systemPrompt || undefined }
        : systemPrompt
          ? { systemPrompt }
          : undefined;

      const cleanEnv = { ...process.env };
      delete cleanEnv.CLAUDECODE;

      execSync(
        `tmux new-session -d -s ${tmuxName} -x 120 -y 40 -c ${JSON.stringify(cwd)}`,
        { stdio: 'pipe', env: cleanEnv },
      );

      const session = sessionRepo.create({
        trackId,
        tmuxSession: tmuxName,
        systemPrompt: systemPrompt || undefined,
        state: 'active',
        provider,
        background: options?.background ?? false,
      });

      if (!options?.skipClaude) {
        launchCli(session, tmuxName, cwd, effectiveOptions);
      }

      return session;
    },

    async destroySession(sessionId: SessionId): Promise<void> {
      const session = sessionRepo.findById(sessionId);
      if (!session) return;

      try {
        execSync(`tmux kill-session -t ${session.tmuxSession}`, { stdio: 'pipe' });
      } catch {
        // Session might already be dead
      }

      cleanSessionDir(sessionId);
      sessionRepo.delete(sessionId);
      clearSessionMaps(sessionId);
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

        // --- Background session cleanup (aggressive) ---
        // Matrix-dedicated sessions are long-lived — skip idle reaping
        const isMatrixSession = session.name?.startsWith('[matrix] ');
        if (session.background && !isMatrixSession) {
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

          // Background idle timeout — Claude at prompt with no work
          if (isSessionIdle(session, capturedLines)) {
            const idleMinutes = getIdleMinutes(session);
            if (idleMinutes >= BACKGROUND_IDLE_TIMEOUT_MINUTES) {
              reap(session, `background: idle ${Math.round(idleMinutes)}m`);
            }
          } else {
            idleFirstSeen.delete(session.id);
          }
        }
        // Interactive sessions are left alone — the user manages them
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
          // Use the track's first repo path, or HOME
          const cwd = process.env.HOME || '/tmp';

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
  };
}
