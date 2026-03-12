import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync, chmodSync } from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type { SessionRepository } from '@domain/session/repository';
import type { Session, SessionId, TrackId } from '@foundation/types';

/** Directory for per-session data (prompt files, hook config, etc.) */
const SESSION_DATA_DIR = path.join(
  process.env.HOME || '/tmp',
  '.workshop',
  'sessions',
);

/** Workshop API URL for hook callbacks */
const WORKSHOP_API_URL = process.env.WORKSHOP_API_URL || 'http://localhost:3002';

export interface CreateSessionOptions {
  systemPrompt?: string;
  workingDirectory?: string;
  /** If true, do not start Claude Code in the tmux session. Defaults to false. */
  skipClaude?: boolean;
  /** If true, the session runs in the background with permission hooks. Defaults to false. */
  background?: boolean;
  /** Todo ID if dispatched from a todo (used in system prompt extension). */
  todoId?: string;
  /** Initial prompt to send to Claude (the task to work on). */
  initialPrompt?: string;
}

export interface TerminalManager {
  createSession(trackId: TrackId, options?: CreateSessionOptions): Promise<Session>;
  destroySession(sessionId: SessionId): Promise<void>;
  isSessionAlive(session: Session): boolean;
  syncSessionStates(): void;
}

export function createTerminalManager(sessionRepo: SessionRepository): TerminalManager {
  try {
    execSync('which tmux', { stdio: 'pipe' });
  } catch {
    console.warn('tmux not found in PATH. Terminal sessions will not work.');
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

  /** Write a Claude Code settings file with the permission hook for background agents */
  function writeHookSettings(sessionDir: string, sessionId: string): string {
    const settingsFile = path.join(sessionDir, 'settings.json');
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash|Edit|Write|NotebookEdit',
            hooks: [
              {
                type: 'http',
                url: `${WORKSHOP_API_URL}/api/hooks/permission`,
                headers: {
                  'X-Workshop-Session': sessionId,
                },
              },
            ],
          },
        ],
      },
    };
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
    return settingsFile;
  }

  /** Append background agent instructions to the system prompt */
  function appendBackgroundInstructions(prompt: string, todoId?: string): string {
    const instructions = [
      '',
      '---',
      '',
      '## Background Agent Instructions',
      '',
      'You are running as a background agent dispatched from Workshop.',
      'A human will review and approve/deny your tool calls — they see each',
      'request in the Workshop UI. Keep working through denials by adjusting',
      'your approach.',
      '',
    ];

    if (todoId) {
      instructions.push(
        'When you have completed the task (or determined you cannot proceed):',
        `1. Use the workshop_update_todo MCP tool to update todo "${todoId}" status to "review"`,
        '2. Add a brief summary of what you accomplished or why you stopped to the description',
        '',
      );
    }

    return prompt + instructions.join('\n');
  }

  return {
    async createSession(trackId: TrackId, options?: CreateSessionOptions): Promise<Session> {
      const tmuxName = `workshop-${uuid().slice(0, 8)}`;
      const cwd = options?.workingDirectory || process.env.HOME || '/tmp';

      const cleanEnv = { ...process.env };
      delete cleanEnv.CLAUDECODE;

      execSync(
        `tmux new-session -d -s ${tmuxName} -x 120 -y 40 -c ${JSON.stringify(cwd)}`,
        { stdio: 'pipe', env: cleanEnv },
      );

      const session = sessionRepo.create({
        trackId,
        tmuxSession: tmuxName,
        systemPrompt: options?.systemPrompt,
        state: 'active',
        background: options?.background ?? false,
      });

      if (!options?.skipClaude) {
        const sessionDir = getSessionDir(session.id);
        const launcherFile = path.join(sessionDir, 'launch.sh');
        const launcherLines = ['#!/bin/bash', 'set -e', ''];
        const claudeArgs = ['claude'];

        if (options?.systemPrompt) {
          let prompt = options.systemPrompt;
          if (options.background) {
            prompt = appendBackgroundInstructions(prompt, options.todoId);
          }
          const promptFile = path.join(sessionDir, 'system-prompt.md');
          writeFileSync(promptFile, prompt, 'utf-8');
          claudeArgs.push('--system-prompt-file', JSON.stringify(promptFile));
        }

        if (options?.background) {
          const settingsFile = writeHookSettings(sessionDir, session.id);
          claudeArgs.push('--settings', JSON.stringify(settingsFile));
        }

        // For background agents, use -p with the initial prompt piped from a file.
        // Claude runs the task autonomously and exits when done.
        // The user can still attach to the tmux session to monitor output.
        if (options?.initialPrompt) {
          const promptMsgFile = path.join(sessionDir, 'initial-prompt.txt');
          writeFileSync(promptMsgFile, options.initialPrompt, 'utf-8');
          launcherLines.push(`exec ${claudeArgs.join(' ')} -p "$(cat ${JSON.stringify(promptMsgFile)})"`);
        } else {
          launcherLines.push(`exec ${claudeArgs.join(' ')}`);
        }

        writeFileSync(launcherFile, launcherLines.join('\n') + '\n', 'utf-8');
        chmodSync(launcherFile, 0o755);

        // Launch via the script — avoids all quoting issues with tmux send-keys
        execSync(
          `tmux send-keys -t ${tmuxName} ${JSON.stringify(launcherFile)} Enter`,
          { stdio: 'pipe' },
        );
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
