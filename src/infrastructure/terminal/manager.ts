import { execSync, spawn } from 'child_process';
import { v4 as uuid } from 'uuid';
import type { SessionRepository } from '@domain/session/repository';
import type { Session, SessionId, TrackId } from '@foundation/types';

interface CreateSessionOptions {
  systemPrompt?: string;
  workingDirectory?: string;
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

      // Create tmux session with claude code
      const claudeArgs = ['claude'];
      if (options?.systemPrompt) {
        claudeArgs.push('--system-prompt', options.systemPrompt);
      }

      // Create a detached tmux session running Claude Code
      execSync(
        `tmux new-session -d -s ${tmuxName} -c ${JSON.stringify(cwd)} ${claudeArgs.map((a) => JSON.stringify(a)).join(' ')}`,
        { stdio: 'pipe' },
      );

      const session = sessionRepo.create({
        trackId,
        tmuxSession: tmuxName,
        systemPrompt: options?.systemPrompt,
        state: 'active',
      });

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
