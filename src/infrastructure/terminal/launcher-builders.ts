import { execSync } from 'child_process';
import { writeFileSync, chmodSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { SessionProvider } from '@foundation/types';
import type { CreateSessionOptions } from './manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Workshop API URL for hook callbacks — derived from PORT so it matches the server's own binding */
const WORKSHOP_API_URL = process.env.WORKSHOP_API_URL || `http://localhost:${process.env.PORT || '3001'}`;

/**
 * Write a Claude Code settings file with hooks.
 *
 * ALL sessions get SessionStart + SessionEnd hooks so we can track Claude's
 * session ID for --resume support. SubagentStop is added when an
 * executionTicketId is present (workflow progress tracking).
 *
 * All hooks use type: 'command' (curl scripts) — Claude Code does not support
 * type: 'http' hooks and silently ignores them.
 */
export function writeHookSettings(
  sessionDir: string,
  sessionId: string,
  options?: { executionTicketId?: string; mcpServers?: Record<string, unknown> },
): string {
  const settingsFile = path.join(sessionDir, 'settings.json');
  const hooks: Record<string, unknown[]> = {};

  const scriptsDir = path.resolve(__dirname, '../../../scripts');

  // --- Always-on hooks: SessionStart + SessionEnd ---

  // SessionStart: capture Claude's session ID for --resume support
  const sessionStartScript = path.join(scriptsDir, 'session-start-hook.sh');
  hooks.SessionStart = [
    {
      hooks: [
        {
          type: 'command',
          command: `WORKSHOP_API_URL=${WORKSHOP_API_URL} WORKSHOP_SESSION_ID=${sessionId} ${sessionStartScript}`,
        },
      ],
    },
  ];

  // SessionEnd: clean up when Claude exits
  const sessionEndScript = path.join(scriptsDir, 'session-end-hook.sh');
  hooks.SessionEnd = [
    {
      hooks: [
        {
          type: 'command',
          command: `WORKSHOP_API_URL=${WORKSHOP_API_URL} WORKSHOP_SESSION_ID=${sessionId} ${sessionEndScript}`,
        },
      ],
    },
  ];

  // --- SubagentStop: workflow progress tracking ---

  if (options?.executionTicketId) {
    const agentProgressScript = path.join(scriptsDir, 'agent-progress-hook.sh');
    hooks.SubagentStop = [
      {
        hooks: [
          {
            type: 'command',
            command: `WORKSHOP_API_URL=${WORKSHOP_API_URL} WORKSHOP_SESSION_ID=${sessionId} WORKSHOP_TICKET_ID=${options.executionTicketId} ${agentProgressScript}`,
          },
        ],
      },
    ];
  }

  const settings: Record<string, unknown> = { hooks };
  if (options?.mcpServers) {
    settings.mcpServers = options.mcpServers;
  }
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
  return settingsFile;
}

/** Append background agent instructions to the system prompt */
export function appendBackgroundInstructions(prompt: string, todoId?: string): string {
  const instructions = [
    '',
    '---',
    '',
    '## Background Agent Instructions',
    '',
    'You are running as a background agent dispatched from Workshop.',
    '',
  ];

  if (todoId) {
    instructions.push(
      'When you have completed the task (or determined you cannot proceed):',
      `1. Use the workshop_update_todo MCP tool to update todo "${todoId}" status to "review"`,
      '2. Add a brief summary of what you accomplished or why you stopped to the description',
      '3. Use /exit to close your session',
      '',
    );
  } else {
    instructions.push(
      'When you have completed your task (or determined you cannot proceed),',
      'use /exit to close your session so resources are freed.',
      '',
    );
  }

  return prompt + instructions.join('\n');
}

/** Build launcher script lines for a Claude Code session */
export function buildClaudeLauncher(
  lines: string[],
  sessionId: string,
  sessionDir: string,
  tmuxName: string,
  cwd: string,
  options?: CreateSessionOptions,
): void {
  // Change to the original working directory before launching Claude.
  // Claude determines which project bucket to use based on its CWD — resuming
  // from the wrong directory causes "No conversation found" errors.
  lines.push(`cd ${JSON.stringify(cwd)}`);
  lines.push('');

  const claudeArgs = ['claude'];

  // Resume a previous Claude session if we have a resume ID
  if (options?.claudeResumeId) {
    claudeArgs.push('--resume', options.claudeResumeId);
  }

  if (options?.systemPrompt && !options?.claudeResumeId) {
    let prompt = options.systemPrompt;
    if (options.background && !options.skipBackgroundInstructions) {
      prompt = appendBackgroundInstructions(prompt, options.todoId);
    }
    const promptFile = path.join(sessionDir, 'system-prompt.md');
    writeFileSync(promptFile, prompt, 'utf-8');
    claudeArgs.push('--system-prompt-file', JSON.stringify(promptFile));
  }

  // Only skip permission prompts when explicitly opted in by the caller.
  if (options?.background && options?.dangerouslySkipPermissions) {
    claudeArgs.push('--dangerously-skip-permissions');
  }

  // Grant tool access to any additional track paths beyond the CWD.
  // (The CWD itself is already accessible to Claude by default.)
  for (const dir of options?.additionalDirs ?? []) {
    claudeArgs.push('--add-dir', JSON.stringify(dir));
  }

  // Always write a settings file (SessionStart + SessionEnd hooks for resume tracking,
  // SubagentStop for workflow progress if executionTicketId is present).
  const settingsFile = writeHookSettings(sessionDir, sessionId, {
    executionTicketId: options?.executionTicketId,
    mcpServers: options?.mcpServers,
  });
  claudeArgs.push('--settings', JSON.stringify(settingsFile));

  // Pre-approve tool patterns so interactive sessions don't block on permission prompts
  if (options?.allowedTools && options.allowedTools.length > 0) {
    for (const tool of options.allowedTools) {
      claudeArgs.push('--allowedTools', JSON.stringify(tool));
    }
  }



  // Pass the initial prompt as a positional argument to claude so it's sent
  // as the first message. This is reliable — no tmux paste race conditions.
  // We write it to a file and use $(cat ...) to avoid shell quoting issues.
  // (Not used for resumed sessions — they already have conversation context.)
  if (options?.initialPrompt && !options?.claudeResumeId) {
    const promptMsgFile = path.join(sessionDir, 'initial-prompt.txt');
    writeFileSync(promptMsgFile, options.initialPrompt, 'utf-8');
    lines.push(`exec ${claudeArgs.join(' ')} "$(cat ${JSON.stringify(promptMsgFile)})"`);
  } else {
    lines.push(`exec ${claudeArgs.join(' ')}`);
  }
}

/** Build launcher script lines for a Gemini CLI session */
export function buildGeminiLauncher(
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
export function buildCodexLauncher(
  lines: string[],
  sessionDir: string,
  cwd: string,
  options?: CreateSessionOptions,
): void {
  const codexArgs = ['codex'];
  const promptFile = path.join(sessionDir, 'system-prompt.md');

  if (options?.background) {
    codexArgs.push('exec', '--full-auto', '-C', JSON.stringify(cwd));

    let fullPrompt = '';
    if (options?.systemPrompt) {
      let prompt = options.systemPrompt;
      if (!options.skipBackgroundInstructions) {
        prompt = appendBackgroundInstructions(prompt, options.todoId);
      }
      fullPrompt += prompt + '\n\n---\n\n';
    }
    if (options?.initialPrompt) {
      fullPrompt += options.initialPrompt;
    }

    writeFileSync(promptFile, fullPrompt, 'utf-8');
    lines.push(`exec ${codexArgs.join(' ')} "$(cat ${JSON.stringify(promptFile)})"`);
  } else {
    codexArgs.push('-C', JSON.stringify(cwd));

    if (options?.systemPrompt) {
      writeFileSync(promptFile, options.systemPrompt, 'utf-8');
      lines.push(`exec ${codexArgs.join(' ')} "$(cat ${JSON.stringify(promptFile)})"`);
    } else {
      lines.push(`exec ${codexArgs.join(' ')}`);
    }

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
 * Runs as a detached background process so it doesn't block session creation.
 */
export function sendInitialPrompt(
  sessionDir: string,
  tmuxName: string,
  provider: SessionProvider = 'claude',
): void {
  const promptMsgFile = path.join(sessionDir, 'initial-prompt.txt');
  const senderScript = path.join(sessionDir, 'send-prompt.sh');
  const logFile = path.join(sessionDir, 'send-prompt.log');

  // Different CLIs use different prompt indicators
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

  try {
    execSync(`nohup ${JSON.stringify(senderScript)} >> ${JSON.stringify(logFile)} 2>&1 &`, {
      stdio: 'pipe',
      shell: '/bin/bash',
    });
  } catch (err) {
    console.error(`Failed to start prompt sender for ${tmuxName}:`, err);
  }
}
