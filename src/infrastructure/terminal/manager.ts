import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync, chmodSync } from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type { SessionRepository } from '@domain/session/repository';
import type { Session, SessionId, TrackId } from '@foundation/types';
import type { SoulLoader } from '@infrastructure/soul/soul-loader.js';
import { isSessionIdle, isSessionLoggedOut, isSessionExited } from './pane-detection.js';
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

/** Minutes a background session can sit idle at the CLI prompt before being reaped */
const BACKGROUND_IDLE_TIMEOUT_MINUTES = 5;

export function createTerminalManager(sessionRepo: SessionRepository, soulLoader?: SoulLoader): TerminalManager {
  try {
    execSync('which tmux', { stdio: 'pipe' });
  } catch {
    console.warn('tmux not found in PATH. Terminal sessions will not work.');
  }

  /** Track when we first observe a session idle, keyed by session ID */
  const idleFirstSeen = new Map<string, number>();

  /** Get how many minutes a session has been observed idle */
  function getIdleMinutes(session: Session): number {
    const firstSeen = idleFirstSeen.get(session.id);
    if (!firstSeen) {
      idleFirstSeen.set(session.id, Date.now());
      return 0;
    }
    return (Date.now() - firstSeen) / 60_000;
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

        // Launch via the script — avoids all quoting issues with tmux send-keys
        execSync(
          `tmux send-keys -t ${tmuxName} ${JSON.stringify(launcherFile)} Enter`,
          { stdio: 'pipe' },
        );

        // For non-Claude providers, use the tmux paste helper to deliver the
        // initial prompt after the TUI is ready. Claude handles this via
        // positional argument in the launch script (no race condition).
        if (options?.initialPrompt && provider !== 'claude') {
          sendInitialPrompt(sessionDir, tmuxName, provider);
        }
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
      idleFirstSeen.delete(sessionId);
    },

    isSessionAlive(session: Session): boolean {
      try {
        execSync(`tmux has-session -t ${session.tmuxSession}`, { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },

    syncSessionStates(): SyncResult {
      const allSessions = sessionRepo.findAll();
      const cleaned: SyncResult['cleaned'] = [];

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
        idleFirstSeen.delete(session.id);
        cleaned.push({ sessionId: session.id, trackId: session.trackId });
      };

      for (const session of allSessions) {
        const alive = this.isSessionAlive(session);

        // 1. tmux session is gone — clean up the DB record
        if (!alive && session.state !== 'dead') {
          reap(session, 'tmux session dead');
          continue;
        }

        // 2. Marked dead in DB but tmux is still alive — resurrect
        if (alive && session.state === 'dead') {
          sessionRepo.updateState(session.id, 'active');
          continue;
        }

        // Skip non-alive sessions from here on
        if (!alive) continue;

        // --- Background session cleanup (aggressive) ---
        if (session.background) {
          // Background session not logged in — reap immediately
          if (isSessionLoggedOut(session)) {
            reap(session, 'background: Claude not logged in');
            continue;
          }

          // Background CLI exited (bare shell prompt) — reap immediately
          if (isSessionExited(session)) {
            reap(session, 'background: CLI exited (bare shell prompt)');
            continue;
          }

          // Background idle timeout — Claude at prompt with no work
          if (isSessionIdle(session)) {
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
      return { cleaned };
    },
  };
}
