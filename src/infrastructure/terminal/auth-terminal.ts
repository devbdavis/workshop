import { execSync } from 'child_process';
import { v4 as uuid } from 'uuid';

/**
 * Ephemeral, DB-less auth terminals.
 *
 * The regular session pipeline stores rows in `sessions`, which has a NOT NULL
 * FK to `tracks` (with foreign_keys=ON). Authentication popups have no track,
 * so they MUST NOT touch the sessions table. Instead we keep a small in-memory
 * map of authId -> tmux session name and let websocket.ts attach to it.
 *
 * The login command is sent via `send-keys` (not run via `tmux new-session
 * <cmd>`) so the shell stays alive after the command exits — the user can
 * correct or re-run the login flow (e.g. picking a different gh auth method).
 */

/** authId -> tmux session name */
const authSessions = new Map<string, string>();

export interface AuthTerminalHandle {
  authId: string;
  tmuxSession: string;
}

export async function startAuthTerminal(loginCommand: string): Promise<AuthTerminalHandle> {
  const authId = uuid();
  const tmuxName = `workshop-auth-${authId.slice(0, 8)}`;

  // Mirror manager.ts: drop CLAUDECODE so the spawned CLI doesn't think it's
  // running inside another Claude Code instance.
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;

  const cwd = process.env.HOME || '/tmp';
  execSync(`tmux new-session -d -s ${tmuxName} -x 120 -y 40 -c ${JSON.stringify(cwd)}`, {
    stdio: 'pipe',
    env: cleanEnv,
  });

  // Wait for the shell to produce its prompt before sending keys — a send-keys
  // fired before the shell is ready is silently dropped (see manager.ts).
  const shellReadyDeadline = Date.now() + 5000;
  while (Date.now() < shellReadyDeadline) {
    try {
      const pane = execSync(`tmux capture-pane -t ${tmuxName} -p`, {
        stdio: 'pipe',
        encoding: 'utf-8',
        timeout: 1000,
      });
      if (pane.trim().length > 0) break;
    } catch {
      /* session not visible yet — keep trying */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  execSync(`tmux send-keys -t ${tmuxName} ${JSON.stringify(loginCommand)} Enter`, {
    stdio: 'pipe',
    env: cleanEnv,
  });

  authSessions.set(authId, tmuxName);
  return { authId, tmuxSession: tmuxName };
}

export function getAuthTmux(authId: string): string | undefined {
  return authSessions.get(authId);
}

export function stopAuthTerminal(authId: string): void {
  const tmuxName = authSessions.get(authId);
  if (!tmuxName) return;
  try {
    execSync(`tmux kill-session -t ${tmuxName}`, { stdio: 'pipe' });
  } catch {
    // best-effort — session may already be gone
  }
  authSessions.delete(authId);
}
