import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type { SessionRepository } from '@domain/session/repository';
import type { Session, SessionId, TrackId } from '@foundation/types';

/** Directory for per-session data (prompt files, etc.) */
const SESSION_DATA_DIR = path.join(
  process.env.HOME || '/tmp',
  '.workshop',
  'sessions',
);

export interface CreateSessionOptions {
  systemPrompt?: string;
  workingDirectory?: string;
  /** If true, do not start Claude Code in the tmux session (just leave the shell). Defaults to false. */
  skipClaude?: boolean;
  /** If true, the session runs in the background (not shown in the main terminal area). Defaults to false. */
  background?: boolean;
}

export interface TerminalManager {
  createSession(trackId: TrackId, options?: CreateSessionOptions): Promise<Session>;
  destroySession(sessionId: SessionId): Promise<void>;
  isSessionAlive(session: Session): boolean;
  syncSessionStates(): void;
}

export function createTerminalManager(sessionRepo: SessionRepository): TerminalManager {
  // Ensure tmux is available
  try {
    execSync('which tmux', { stdio: 'pipe' });
  } catch {
    console.warn('tmux not found in PATH. Terminal sessions will not work.');
  }

  /** Get the data directory for a session, creating it if needed */
  function getSessionDir(sessionId: string): string {
    const dir = path.join(SESSION_DATA_DIR, sessionId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Clean up a session's data directory */
  function cleanSessionDir(sessionId: string): void {
    const dir = path.join(SESSION_DATA_DIR, sessionId);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  return {
    async createSession(trackId: TrackId, options?: CreateSessionOptions): Promise<Session> {
      const tmuxName = `workshop-${uuid().slice(0, 8)}`;
      const cwd = options?.workingDirectory || process.env.HOME || '/tmp';

      // Step 1: Create a detached tmux session with just a shell
      // Build a clean env without CLAUDECODE so spawned Claude sessions work
      const cleanEnv = { ...process.env };
      delete cleanEnv.CLAUDECODE;

      execSync(
        `tmux new-session -d -s ${tmuxName} -x 120 -y 40 -c ${JSON.stringify(cwd)}`,
        { stdio: 'pipe', env: cleanEnv },
      );

      // Step 2: Record the session in the database
      const session = sessionRepo.create({
        trackId,
        tmuxSession: tmuxName,
        systemPrompt: options?.systemPrompt,
        state: 'active',
        background: options?.background ?? false,
      });

      // Step 3: Optionally start Claude Code inside the tmux session
      if (!options?.skipClaude) {
        const claudeArgs = ['claude'];

        if (options?.systemPrompt) {
          // Write system prompt to a stable per-session directory
          // (cleaned up when session is destroyed, not on a timer)
          const sessionDir = getSessionDir(session.id);
          const promptFile = path.join(sessionDir, 'system-prompt.md');
          writeFileSync(promptFile, options.systemPrompt, 'utf-8');
          claudeArgs.push('--system-prompt-file', promptFile);
        }

        // Send the command to the tmux session as a single literal string
        const cmd = claudeArgs.join(' ');
        execSync(
          `tmux send-keys -t ${tmuxName} ${JSON.stringify(cmd)} Enter`,
          { stdio: 'pipe' },
        );
      }

      return session;
    },

    async destroySession(sessionId: SessionId): Promise<void> {
      const session = sessionRepo.findById(sessionId);
      if (!session) return;

      // Kill the tmux session
      try {
        execSync(`tmux kill-session -t ${session.tmuxSession}`, { stdio: 'pipe' });
      } catch {
        // Session might already be dead
      }

      // Clean up session data directory (prompt files, etc.)
      cleanSessionDir(sessionId);

      sessionRepo.delete(sessionId);
    },

    isSessionAlive(session: Session): boolean {
      try {
        execSync(`tmux has-session -t ${session.tmuxSession}`, { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    },

    syncSessionStates(): void {
      const allSessions = sessionRepo.findAll();
      let cleaned = 0;
      for (const session of allSessions) {
        const alive = this.isSessionAlive(session);
        if (!alive && session.state !== 'dead') {
          // tmux session gone — kill it if somehow still lingering, then remove from DB
          try {
            execSync(`tmux kill-session -t ${session.tmuxSession}`, { stdio: 'pipe' });
          } catch {
            // Already dead
          }
          cleanSessionDir(session.id);
          sessionRepo.delete(session.id);
          cleaned++;
        } else if (alive && session.state === 'dead') {
          sessionRepo.updateState(session.id, 'active');
        }
      }
      if (cleaned > 0) {
        console.log(`Session sync: cleaned up ${cleaned} dead session(s)`);
      }
    },
  };
}
