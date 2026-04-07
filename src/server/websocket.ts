import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { execSync } from 'child_process';
import * as pty from 'node-pty';
import type { IncomingMessage } from 'http';
import { createSessionRepository } from '@infrastructure/persistence/session-repository.js';
import { addEventClient } from './events.js';
import { extractToken, validateToken } from './auth-middleware.js';
import type { SessionId } from '@foundation/types';
import type { IPty } from 'node-pty';

/** Tracks an active pty connection for a given session. */
interface PtyConnection {
  pty: IPty;
  ws: WebSocket;
  tmuxSession: string;
}

// Resolve tmux path once at startup so node-pty can find it
const tmuxPath = (() => {
  try {
    return execSync('which tmux', { stdio: 'pipe' }).toString().trim();
  } catch {
    return 'tmux';
  }
})();

export function setupWebSocket(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });
  const sessions = createSessionRepository();

  // Map from sessionId to the active pty connection
  const activePtys = new Map<string, PtyConnection>();

  const eventsWss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    // Authenticate before allowing any WebSocket upgrade
    const token = extractToken(request);
    if (!validateToken(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const url = new URL(request.url || '', `http://${request.headers.host}`);

    // Event notification channel
    if (url.pathname === '/ws/events') {
      eventsWss.handleUpgrade(request, socket, head, (ws) => {
        addEventClient(ws);
      });
      return;
    }

    // Terminal connections
    const match = url.pathname.match(/^\/ws\/tracks\/[^/]+\/sessions\/([^/]+)\/terminal$/);
    if (!match) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const sessionId = match[1] as SessionId;
      handleTerminalConnection(ws, sessionId);
    });
  });

  /**
   * Poll for the tmux session to exist, returning true when ready or false on timeout.
   * Used to handle the window between session record creation and background tmux init.
   */
  function waitForTmux(tmuxSession: string, maxWaitMs = 30_000, intervalMs = 500): Promise<boolean> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        try {
          execSync(`tmux has-session -t ${tmuxSession}`, { stdio: 'pipe' });
          resolve(true);
          return;
        } catch { /* not ready yet */ }
        if (Date.now() - start >= maxWaitMs) {
          resolve(false);
          return;
        }
        setTimeout(check, intervalMs);
      };
      check();
    });
  }

  async function handleTerminalConnection(ws: WebSocket, sessionId: SessionId): Promise<void> {
    const session = sessions.findById(sessionId);
    if (!session) {
      ws.close(1008, 'Session not found');
      return;
    }

    // If there's already an active pty for this session, clean it up first.
    // The old WebSocket may have disconnected without proper cleanup.
    const existing = activePtys.get(sessionId);
    if (existing) {
      try {
        existing.pty.kill();
      } catch {
        // pty may already be dead
      }
      if (existing.ws.readyState === WebSocket.OPEN) {
        existing.ws.close(1000, 'Replaced by new connection');
      }
      activePtys.delete(sessionId);
    }

    // Wait for the tmux session to appear — it may still be initialising in the
    // background (worktree creation, git fetch, etc.). Poll up to 30s.
    const tmuxReady = await waitForTmux(session.tmuxSession);
    if (!tmuxReady) {
      ws.close(1008, 'tmux session not found');
      return;
    }

    // Spawn a pty running `tmux attach-session`
    let ptyProcess: IPty;
    try {
      // Filter out undefined env values that can cause node-pty to fail
      const cleanEnv: { [key: string]: string } = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) cleanEnv[k] = v;
      }
      ptyProcess = pty.spawn(tmuxPath, ['attach-session', '-t', session.tmuxSession], {
        name: 'xterm-256color',
        cols: 120,
        rows: 40,
        env: cleanEnv,
      });
    } catch (err) {
      console.error(`Failed to spawn pty for session ${sessionId}:`, err);
      ws.close(1011, 'Failed to spawn terminal');
      return;
    }

    const connection: PtyConnection = {
      pty: ptyProcess,
      ws,
      tmuxSession: session.tmuxSession,
    };
    activePtys.set(sessionId, connection);

    // Pipe pty output to WebSocket
    const dataDisposable = ptyProcess.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Handle pty exit: dispose data handler first to prevent any final writes
    // racing the close, then terminate immediately rather than sending a CLOSE
    // frame — the client may already be gone (navigated away / component
    // unmounted), and sending a CLOSE frame to a dead Vite proxy socket
    // produces a spurious EPIPE.
    const exitDisposable = ptyProcess.onExit(() => {
      dataDisposable.dispose();
      activePtys.delete(sessionId);
      if (ws.readyState !== WebSocket.CLOSED) {
        ws.terminate();
      }
    });

    // Handle incoming WebSocket messages
    ws.on('message', (data: Buffer | string) => {
      const msg = typeof data === 'string' ? data : data.toString('utf-8');

      // Check if it's a JSON control message
      if (msg.startsWith('{')) {
        try {
          const ctrl = JSON.parse(msg) as { type: string; cols?: number; rows?: number };
          if (ctrl.type === 'resize' && ctrl.cols && ctrl.rows) {
            // Validate cols/rows are integers in a safe range to prevent injection
            const cols = Math.floor(Number(ctrl.cols));
            const rows = Math.floor(Number(ctrl.rows));
            if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || cols > 500 || rows < 1 || rows > 500) {
              return;
            }

            // Resize the pty
            ptyProcess.resize(cols, rows);

            // Also resize the tmux window so tmux knows the new dimensions
            try {
              execSync(
                `tmux resize-window -t ${session.tmuxSession} -x ${cols} -y ${rows}`,
                { stdio: 'pipe' },
              );
            } catch {
              // Resize might fail if session is dead
            }
            return;
          }
        } catch {
          // Not valid JSON, treat as terminal input
        }
      }

      // Write terminal input to the pty
      ptyProcess.write(msg);
    });

    // Handle WebSocket close: kill the pty but NOT the tmux session
    ws.on('close', () => {
      dataDisposable.dispose();
      exitDisposable.dispose();
      try {
        ptyProcess.kill();
      } catch {
        // pty may already be dead
      }
      activePtys.delete(sessionId);
    });

    // Handle WebSocket errors — EPIPE and ECONNRESET are expected whenever the
    // client disconnects while the session is still active; only log genuinely
    // unexpected errors.
    ws.on('error', (err: Error & { code?: string }) => {
      dataDisposable.dispose();
      exitDisposable.dispose();
      if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
        console.error(`WebSocket error for session ${sessionId}:`, err.message);
      }
      try {
        ptyProcess.kill();
      } catch {
        // pty may already be dead
      }
      activePtys.delete(sessionId);
    });
  }
}
