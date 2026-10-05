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
 * session ID for --resume support, plus activity hooks (UserPromptSubmit, Stop,
 * Notification, PreToolUse) that report working/idle/needs-input instantly.
 * SubagentStop is added when an executionTicketId is present (workflow progress tracking).
 *
 * All hooks use type: 'command' (curl scripts) — Claude Code does not support
 * type: 'http' hooks and silently ignores them.
 */
export function writeHookSettings(
  sessionDir: string,
  sessionId: string,
  options?: {
    executionTicketId?: string;
    mcpServers?: Record<string, unknown>;
    enabledPlugins?: Record<string, boolean>;
    /** --print runs have no TUI to watch; their end-of-run Stop must not raise an idle alert. */
    skipActivityHooks?: boolean;
  },
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

  // Activity hooks: instant working/idle/needs-input, pane scraping is only the fallback
  const activityScript = path.join(scriptsDir, 'session-activity-hook.sh');
  const activityHook = (status: string, matcher?: string) => ({
    ...(matcher ? { matcher } : {}),
    hooks: [
      {
        type: 'command',
        command: `WORKSHOP_API_URL=${WORKSHOP_API_URL} WORKSHOP_SESSION_ID=${sessionId} ${activityScript} ${status}`,
      },
    ],
  });
  if (!options?.skipActivityHooks) {
    hooks.UserPromptSubmit = [activityHook('working')];
    hooks.Stop = [activityHook('idle')];
    hooks.Notification = [activityHook('needs-input', 'permission_prompt|elicitation_dialog')];
    hooks.PreToolUse = [activityHook('needs-input', 'AskUserQuestion')];
    hooks.PostToolUse = [activityHook('working', 'AskUserQuestion')];
  }

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

    // StopFailure (matcher: rate_limit) — Dark Factory usage pacing. When an
    // autonomous run hits the Claude usage wall, calibrate the ceiling and pause
    // the run until the window resets. No-ops server-side for non-autonomous tickets.
    const stopFailureScript = path.join(scriptsDir, 'agent-stopfailure-hook.sh');
    hooks.StopFailure = [
      {
        matcher: 'rate_limit',
        hooks: [
          {
            type: 'command',
            command: `WORKSHOP_API_URL=${WORKSHOP_API_URL} WORKSHOP_SESSION_ID=${sessionId} WORKSHOP_TICKET_ID=${options.executionTicketId} ${stopFailureScript}`,
          },
        ],
      },
    ];
  }

  const settings: Record<string, unknown> = { hooks };
  if (options?.mcpServers) {
    settings.mcpServers = options.mcpServers;
  }
  // Per-session plugin enablement — --settings has higher precedence than
  // user settings, so explicit false here disables a user-globally installed
  // plugin (and its hooks) for this session only.
  if (options?.enabledPlugins && Object.keys(options.enabledPlugins).length > 0) {
    settings.enabledPlugins = options.enabledPlugins;
  }
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
  return settingsFile;
}

/** Write an --mcp-config file registering Workshop's MCP server (src/mcp/server.ts). */
export function writeWorkshopMcpConfig(sessionDir: string): string {
  const repoRoot = path.resolve(__dirname, '../../..');
  const file = path.join(sessionDir, 'mcp.json');
  const config = {
    mcpServers: {
      workshop: {
        command: path.join(repoRoot, 'node_modules', '.bin', 'tsx'),
        args: [path.join(repoRoot, 'src', 'mcp', 'server.ts')],
        env: { WORKSHOP_API_URL },
      },
    },
  };
  writeFileSync(file, JSON.stringify(config, null, 2), 'utf-8');
  return file;
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

  // Force Claude's classic inline renderer instead of the full-screen
  // alternate-screen TUI (default since Claude Code v2.1.118). The alternate
  // screen keeps no tmux scrollback (history_size stays 0) and enables SGR
  // mouse mode, which breaks Workshop's capture-based scrollback overlay —
  // the browser terminal can't scroll up at all. Inline rendering keeps the
  // pane's scrollback buffer populated so the overlay works. Use `:=` so an
  // explicit env override (e.g. a user opting back into fullscreen) still wins.
  lines.push(': "${CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN:=1}"');
  lines.push('export CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN');
  lines.push('');

  const claudeArgs = ['claude'];

  // Resume a previous Claude session if we have a resume ID
  if (options?.claudeResumeId) {
    claudeArgs.push('--resume', options.claudeResumeId);
  }

  if (options?.model) {
    claudeArgs.push('--model', JSON.stringify(options.model));
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

  const isScheduled =
    options?.background && !options?.todoId && !options?.interactive && !options?.claudeResumeId;
  // Always write a settings file (SessionStart + SessionEnd hooks for resume tracking,
  // SubagentStop for workflow progress if executionTicketId is present).
  const settingsFile = writeHookSettings(sessionDir, sessionId, {
    executionTicketId: options?.executionTicketId,
    mcpServers: options?.mcpServers,
    enabledPlugins: options?.enabledPlugins,
    skipActivityHooks: !!isScheduled,
  });
  // Always attach Workshop's own MCP server, so sessions don't depend on a
  // user-scope registration in ~/.claude.json (which can be reset). Must precede
  // --settings: --mcp-config is variadic and would swallow a trailing prompt.
  claudeArgs.push('--mcp-config', JSON.stringify(writeWorkshopMcpConfig(sessionDir)));
  claudeArgs.push('--settings', JSON.stringify(settingsFile));

  // Pre-approve tool patterns so interactive sessions don't block on permission prompts
  if (options?.allowedTools && options.allowedTools.length > 0) {
    for (const tool of options.allowedTools) {
      claudeArgs.push('--allowedTools', JSON.stringify(tool));
    }
  }

  // Scheduled background sessions (no todoId) use --print so Claude auto-exits.
  // Todo-dispatched background sessions — and any session opting into
  // `interactive` (e.g. PR-review analyze) — run the interactive TUI so the
  // user can watch progress and chat afterward. Resuming (`claudeResumeId`) is
  // always an interactive reattachment, never --print.
  // Bash stays alive (no exec) for scheduled sessions so the tmux pane remains
  // open long enough for the SessionEnd hook to capture output before cleanup.
  const useExec =
    !options?.background || !!options?.todoId || !!options?.interactive || !!options?.claudeResumeId;
  const cmdPrefix = useExec ? 'exec ' : '';

  if (isScheduled) {
    claudeArgs.push('--print');
  }

  if (options?.initialPrompt && !options?.claudeResumeId) {
    const promptMsgFile = path.join(sessionDir, 'initial-prompt.txt');
    writeFileSync(promptMsgFile, options.initialPrompt, 'utf-8');
    lines.push(`${cmdPrefix}${claudeArgs.join(' ')} "$(cat ${JSON.stringify(promptMsgFile)})"`);
  } else {
    lines.push(`${cmdPrefix}${claudeArgs.join(' ')}`);
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

/**
 * Cursor Agent CLI (`agent` binary). See https://cursor.com/docs/cli/overview
 */
export function buildCursorLauncher(
  lines: string[],
  sessionDir: string,
  cwd: string,
  options?: CreateSessionOptions,
): void {
  const promptFile = path.join(sessionDir, 'system-prompt.md');
  const isScheduled = options?.background && !options?.todoId && !options?.interactive;

  if (isScheduled) {
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
    lines.push(`cd ${JSON.stringify(cwd)}`);
    lines.push('');
    lines.push(
      `exec agent -p "$(cat ${JSON.stringify(promptFile)})" --workspace ${JSON.stringify(cwd)} --approve-mcps --trust --output-format text`,
    );
    return;
  }

  lines.push(`cd ${JSON.stringify(cwd)}`);
  lines.push('');

  const agentArgs = ['agent', '--workspace', JSON.stringify(cwd), '--approve-mcps'];

  if (options?.background && options?.todoId) {
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
    if (fullPrompt) {
      writeFileSync(promptFile, fullPrompt, 'utf-8');
      lines.push(`exec ${agentArgs.join(' ')} "$(cat ${JSON.stringify(promptFile)})"`);
    } else {
      lines.push(`exec ${agentArgs.join(' ')}`);
    }
    return;
  }

  const parts: string[] = [];
  if (options?.systemPrompt) parts.push(options.systemPrompt);
  if (options?.initialPrompt) {
    if (parts.length > 0) parts.push('---', '', options.initialPrompt);
    else parts.push(options.initialPrompt);
  }
  if (parts.length > 0) {
    writeFileSync(promptFile, parts.join('\n'), 'utf-8');
    lines.push(`exec ${agentArgs.join(' ')} "$(cat ${JSON.stringify(promptFile)})"`);
  } else {
    lines.push(`exec ${agentArgs.join(' ')}`);
  }
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
  const grepPattern =
    provider === 'codex' || provider === 'cursor' ? "'^>'" : "'\u276f'";

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
