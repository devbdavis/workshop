import { execSync } from 'child_process';
import { writeFileSync, mkdtempSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type { SessionRepository } from '@domain/session/repository';
import type { Session, SessionId, TrackId } from '@foundation/types';

export interface CreateSessionOptions {
  systemPrompt?: string;
  workingDirectory?: string;
  /** If true, do not start Claude Code in the tmux session (just leave the shell). Defaults to false. */
  skipClaude?: boolean;
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

  return {
    async createSession(trackId: TrackId, options?: CreateSessionOptions): Promise<Session> {
      const tmuxName = `workshop-${uuid().slice(0, 8)}`;
      const cwd = options?.workingDirectory || process.env.HOME || '/tmp';

      // Step 1: Create a detached tmux session with just a shell
      execSync(
        `tmux new-session -d -s ${tmuxName} -x 120 -y 40 -c ${JSON.stringify(cwd)}`,
        { stdio: 'pipe' },
      );

      // Step 2: Record the session in the database
      const session = sessionRepo.create({
        trackId,
        tmuxSession: tmuxName,
        systemPrompt: options?.systemPrompt,
        state: 'active',
      });

      // Step 3: Optionally start Claude Code inside the tmux session
      if (!options?.skipClaude) {
        const claudeArgs = ['claude'];

        if (options?.systemPrompt) {
          // Write system prompt to a temp file so we can pass --system-prompt-file
          const tmpDir = mkdtempSync(path.join(tmpdir(), 'workshop-'));
          const promptFile = path.join(tmpDir, 'system-prompt.md');
          writeFileSync(promptFile, options.systemPrompt, 'utf-8');
          claudeArgs.push('--system-prompt-file', promptFile);

          // Schedule cleanup of the temp file after a short delay
          // (Claude Code will have read it by then)
          setTimeout(() => {
            try {
              unlinkSync(promptFile);
            } catch {
              // Ignore cleanup errors
            }
          }, 5000);
        }

        // Send the command to the tmux session
        const cmd = claudeArgs.map((a) => JSON.stringify(a)).join(' ');
        execSync(
          `tmux send-keys -t ${tmuxName} ${cmd} Enter`,
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
      for (const session of allSessions) {
        const alive = this.isSessionAlive(session);
        if (!alive && session.state !== 'dead') {
          sessionRepo.updateState(session.id, 'dead');
        } else if (alive && session.state === 'dead') {
          sessionRepo.updateState(session.id, 'active');
        }
      }
    },
  };
}
