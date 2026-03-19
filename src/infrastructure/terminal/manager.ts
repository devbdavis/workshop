import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync, chmodSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';
import type { SessionRepository } from '@domain/session/repository';
import type { Session, SessionId, SessionProvider, TrackId } from '@foundation/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  /** Which AI CLI to use. Defaults to 'claude'. */
  provider?: SessionProvider;
  /** If true, do not start the AI CLI in the tmux session. Defaults to false. */
  skipClaude?: boolean;
  /** If true, the session runs in the background with permission hooks. Defaults to false. */
  background?: boolean;
  /** Todo ID if dispatched from a todo (used in system prompt extension). */
  todoId?: string;
  /** Initial prompt to send to the AI CLI (the task to work on). */
  initialPrompt?: string;
  /** If true, skip permission hooks and run with --dangerously-skip-permissions. */
  dangerouslySkipPermissions?: boolean;
  /** Workflow ticket ID — if set, adds SubagentStop + SessionEnd hooks for execution tracking */
  executionTicketId?: string;
  /** Tool patterns to pre-approve (passed as --allowedTools to claude CLI). */
  allowedTools?: string[];
  /** Route tool permissions through Workshop UI even for interactive (non-background) sessions. */
  usePermissionHooks?: boolean;
}

export interface SyncResult {
  cleaned: { sessionId: SessionId; trackId: TrackId }[];
}

export interface TerminalManager {
  createSession(trackId: TrackId, options?: CreateSessionOptions): Promise<Session>;
  destroySession(sessionId: SessionId): Promise<void>;
  isSessionAlive(session: Session): boolean;
  syncSessionStates(): SyncResult;
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

  /** Write a Claude Code settings file with permission + optional execution hooks */
  function writeHookSettings(
    sessionDir: string,
    sessionId: string,
    executionTicketId?: string,
  ): string {
    const settingsFile = path.join(sessionDir, 'settings.json');

    const hooks: Record<string, unknown[]> = {
      PreToolUse: [
        {
          matcher: 'Bash|Edit|Write|NotebookEdit|mcp__.*',
          hooks: [
            {
              type: 'http',
              url: `${WORKSHOP_API_URL}/api/hooks/permission`,
              headers: { 'X-Workshop-Session': sessionId },
            },
          ],
        },
      ],
    };

    if (executionTicketId) {
      hooks.SubagentStop = [
        {
          hooks: [
            {
              type: 'http',
              url: `${WORKSHOP_API_URL}/api/hooks/agent-progress`,
              headers: {
                'X-Workshop-Session': sessionId,
                'X-Workshop-Ticket': executionTicketId,
              },
            },
          ],
        },
      ];

      const hookScript = path.resolve(__dirname, '../../../scripts/session-end-hook.sh');
      hooks.SessionEnd = [
        {
          hooks: [
            {
              type: 'command',
              command: `WORKSHOP_API_URL=${WORKSHOP_API_URL} ${hookScript}`,
            },
          ],
        },
      ];
    }

    const settings = { hooks };
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

  /** Build launcher script lines for a Claude Code session */
  function buildClaudeLauncher(
    lines: string[],
    sessionId: string,
    sessionDir: string,
    options?: CreateSessionOptions,
  ): void {
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

    // Route permissions through Workshop UI for background or hook-enabled sessions
    const needsHooks = options?.background || options?.usePermissionHooks;
    if (needsHooks) {
      if (options?.dangerouslySkipPermissions) {
        claudeArgs.push('--dangerously-skip-permissions');
      } else {
        const settingsFile = writeHookSettings(sessionDir, sessionId, options?.executionTicketId);
        claudeArgs.push('--settings', JSON.stringify(settingsFile));
      }
    }

    // Pre-approve tool patterns so interactive sessions don't block on permission prompts
    if (options?.allowedTools && options.allowedTools.length > 0) {
      for (const tool of options.allowedTools) {
        claudeArgs.push('--allowedTools', JSON.stringify(tool));
      }
    }

    // Always launch interactively so the TUI is visible and attachable.
    // If there's an initial prompt, write it to a file. The launch script
    // will send it after claude's TUI is ready (see sendInitialPrompt below).
    if (options?.initialPrompt) {
      const promptMsgFile = path.join(sessionDir, 'initial-prompt.txt');
      writeFileSync(promptMsgFile, options.initialPrompt, 'utf-8');
    }

    lines.push(`exec ${claudeArgs.join(' ')}`);
  }

  /** Build launcher script lines for a Gemini CLI session */
  function buildGeminiLauncher(
    lines: string[],
    sessionDir: string,
    _cwd: string,
    options?: CreateSessionOptions,
  ): void {
    const geminiArgs = ['gemini'];

    if (options?.systemPrompt) {
      const promptFile = path.join(sessionDir, 'system-prompt.md');
      writeFileSync(promptFile, options.systemPrompt, 'utf-8');
      geminiArgs.push('--system-instruction', JSON.stringify(promptFile));
    }

    // Write initial prompt to file if provided (sendInitialPrompt handles delivery)
    if (options?.initialPrompt) {
      const promptMsgFile = path.join(sessionDir, 'initial-prompt.txt');
      writeFileSync(promptMsgFile, options.initialPrompt, 'utf-8');
    }

    lines.push(`exec ${geminiArgs.join(' ')}`);
  }

  /** Build launcher script lines for a Codex CLI session */
  function buildCodexLauncher(
    lines: string[],
    sessionDir: string,
    cwd: string,
    options?: CreateSessionOptions,
  ): void {
    // Codex doesn't have --system-prompt-file. We write the system prompt to a
    // file and pass it as the initial [PROMPT] argument so codex sees the context.
    // For background agents we use `codex exec --full-auto`.
    const codexArgs = ['codex'];
    const promptFile = path.join(sessionDir, 'system-prompt.md');

    if (options?.background) {
      // Use non-interactive exec mode with full-auto sandbox
      codexArgs.push('exec', '--full-auto', '-C', JSON.stringify(cwd));

      let fullPrompt = '';
      if (options?.systemPrompt) {
        let prompt = options.systemPrompt;
        prompt = appendBackgroundInstructions(prompt, options.todoId);
        fullPrompt += prompt + '\n\n---\n\n';
      }
      if (options?.initialPrompt) {
        fullPrompt += options.initialPrompt;
      }

      writeFileSync(promptFile, fullPrompt, 'utf-8');
      lines.push(`exec ${codexArgs.join(' ')} "$(cat ${JSON.stringify(promptFile)})"`);
    } else {
      // Interactive mode
      codexArgs.push('-C', JSON.stringify(cwd));

      if (options?.systemPrompt) {
        writeFileSync(promptFile, options.systemPrompt, 'utf-8');
        lines.push(`exec ${codexArgs.join(' ')} "$(cat ${JSON.stringify(promptFile)})"`);
      } else {
        lines.push(`exec ${codexArgs.join(' ')}`);
      }

      // Write initial prompt to file if provided (sendInitialPrompt handles delivery)
      if (options?.initialPrompt) {
        const promptMsgFile = path.join(sessionDir, 'initial-prompt.txt');
        writeFileSync(promptMsgFile, options.initialPrompt, 'utf-8');
      }
    }
  }

  /**
   * Write and execute a helper script that waits for the AI CLI TUI to be
   * ready, then pastes the initial prompt and presses Enter.
   *
   * The script polls the tmux pane content until it sees the input prompt
   * indicator (provider-specific), then loads the prompt file into the tmux
   * buffer, pastes it, waits briefly, and sends Enter.
   * Runs as a detached background process so it doesn't block session creation.
   */
  function sendInitialPrompt(
    sessionDir: string,
    tmuxName: string,
    provider: SessionProvider = 'claude',
  ): void {
    const promptMsgFile = path.join(sessionDir, 'initial-prompt.txt');
    const senderScript = path.join(sessionDir, 'send-prompt.sh');

    const logFile = path.join(sessionDir, 'send-prompt.log');

    // Different CLIs use different prompt indicators:
    // - claude/gemini use `❯`
    // - codex uses `>` at start of line (use regex to avoid matching other > chars)
    const grepPattern = provider === 'codex' ? "'^>'" : "'❯'";

    const script = `#!/bin/bash
# Wait for ${provider} TUI to be ready (look for the input prompt indicator)
# 90s timeout to allow for enterprise auth + MCP server connections
for i in $(seq 1 90); do
  if tmux capture-pane -t ${tmuxName} -p 2>/dev/null | grep -q ${grepPattern}; then
    sleep 1
    tmux load-buffer ${JSON.stringify(promptMsgFile)} \\; paste-buffer -t ${tmuxName}
    sleep 0.5
    tmux send-keys -t ${tmuxName} Enter
    echo "[$(date)] Prompt delivered to ${tmuxName} after \${i}s" >> ${JSON.stringify(logFile)}
    exit 0
  fi
  sleep 1
done
echo "[$(date)] Timed out waiting for ${provider} TUI in ${tmuxName} after 90s" >> ${JSON.stringify(logFile)}
exit 1
`;

    writeFileSync(senderScript, script, 'utf-8');
    chmodSync(senderScript, 0o755);

    // Run detached so it doesn't block
    try {
      execSync(`nohup ${JSON.stringify(senderScript)} >> ${JSON.stringify(logFile)} 2>&1 &`, {
        stdio: 'pipe',
        shell: '/bin/bash',
      });
    } catch (err) {
      console.error(`Failed to start prompt sender for ${tmuxName}:`, err);
    }
  }

  return {
    async createSession(trackId: TrackId, options?: CreateSessionOptions): Promise<Session> {
      const provider = options?.provider || 'claude';
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
        provider,
        background: options?.background ?? false,
      });

      if (!options?.skipClaude) {
        const sessionDir = getSessionDir(session.id);
        const launcherFile = path.join(sessionDir, 'launch.sh');
        const launcherLines = ['#!/bin/bash', 'set -e', ''];

        if (provider === 'codex') {
          buildCodexLauncher(launcherLines, sessionDir, cwd, options);
        } else if (provider === 'gemini') {
          buildGeminiLauncher(launcherLines, sessionDir, cwd, options);
        } else if (provider === 'claude') {
          buildClaudeLauncher(launcherLines, session.id, sessionDir, options);
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

        // If there's an initial prompt for an interactive session, write a helper
        // script that waits for the TUI to be ready and then pastes + submits.
        if (options?.initialPrompt && !options?.background) {
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
          cleaned.push({ sessionId: session.id, trackId: session.trackId });
        } else if (alive && session.state === 'dead') {
          sessionRepo.updateState(session.id, 'active');
        }
      }
      if (cleaned.length > 0) {
        console.log(`Session sync: cleaned up ${cleaned.length} dead session(s)`);
      }
      return { cleaned };
    },
  };
}
