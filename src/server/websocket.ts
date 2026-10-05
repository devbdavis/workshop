import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { execSync } from 'child_process';
import * as pty from 'node-pty';
import type { IncomingMessage } from 'http';
import { createSessionRepository } from '@infrastructure/persistence/session-repository.js';
import { getAuthTmux } from '@infrastructure/terminal/auth-terminal.js';
import { addEventClient, broadcast } from './events.js';
import { extractToken, validateToken } from './auth-middleware.js';
import type { CodeServerProxy } from './code-server-proxy.js';
import type { SessionId } from '@foundation/types';
import type { TerminalManager } from '@infrastructure/terminal/manager.js';
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

export function setupWebSocket(
  server: HttpServer,
  terminal: TerminalManager,
  codeServerProxy: CodeServerProxy,
): void {
  const wss = new WebSocketServer({ noServer: true });
  const sessions = createSessionRepository();

  // Map from connKey (sessionId or `auth:<id>`) to the active pty connections.
  // A list, not a single entry: tmux mirrors all attached clients, so two browsers
  // can co-view/co-type the same session — each gets its own pty + WebSocket.
  const activePtys = new Map<string, PtyConnection[]>();

  /** Remove a single connection from its connKey bucket, dropping the bucket when empty. */
  function removePtyConnection(connKey: string, conn: PtyConnection): void {
    const list = activePtys.get(connKey);
    if (!list) return;
    const idx = list.indexOf(conn);
    if (idx !== -1) {
      list.splice(idx, 1);
      // close/error/exit handlers can each call this; only the first removal
      // for a given connection decrements the viewer refcount.
      if (!connKey.startsWith('auth:')) terminal.viewerDetached(connKey as SessionId);
    }
    if (list.length === 0) activePtys.delete(connKey);
  }

  const eventsWss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    // Authenticate before allowing any WebSocket upgrade
    const token = extractToken(request);
    if (!validateToken(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    if (codeServerProxy.handleUpgrade(request, socket, head)) return;

    const url = new URL(request.url || '', `http://${request.headers.host}`);

    // Event notification channel
    if (url.pathname === '/ws/events') {
      eventsWss.handleUpgrade(request, socket, head, (ws) => {
        addEventClient(ws);
      });
      return;
    }

    // Auth terminal connections (ephemeral, no track/session DB record)
    const authMatch = url.pathname.match(/^\/ws\/auth\/([^/]+)\/terminal$/);
    if (authMatch) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        handleAuthTerminalConnection(ws, authMatch[1]);
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
    // A client is actively looking at this session's terminal — drop the
    // unread/attention highlight and let other clients know it cleared.
    if (terminal.clearAttention(sessionId)) {
      broadcast('session:updated', session.trackId);
    }
    // Wait for the tmux session to appear — it may still be initialising in the
    // background (worktree creation, git fetch, etc.). attachTmux polls for it.
    await attachTmux(ws, session.tmuxSession, sessionId);
  }

  /**
   * Auth terminals are ephemeral and not backed by the sessions table. Look up
   * the tmux session name from the in-memory auth map and attach to it. Keyed
   * as `auth:<authId>` in activePtys so it can't collide with session ids.
   */
  async function handleAuthTerminalConnection(ws: WebSocket, authId: string): Promise<void> {
    const tmuxSession = getAuthTmux(authId);
    if (!tmuxSession) {
      ws.close(1008, 'auth terminal not found');
      return;
    }
    await attachTmux(ws, tmuxSession, `auth:${authId}`);
  }

  /**
   * Bridge a WebSocket to a tmux session via a node-pty `attach-session`.
   * Shared by the session and auth terminal paths. `connKey` keys the
   * activePtys map (a sessionId, or `auth:<authId>`).
   */
  async function attachTmux(ws: WebSocket, tmuxSession: string, connKey: string): Promise<void> {
    // Co-view: we do NOT evict existing clients. tmux mirrors output to every
    // attached client, so multiple browsers can watch and type in the same session.
    // With >1 client, tmux otherwise pins the window to the smallest client's size;
    // `window-size latest` makes the most-recently-active client drive the size,
    // which matches the natural co-view expectation.
    try {
      execSync(`tmux set-window-option -t ${tmuxSession} window-size latest`, { stdio: 'pipe' });
    } catch {
      // Non-fatal: session may not exist yet (we poll for it below) or option unsupported.
    }

    // The client's ws.onopen fires as soon as the upgrade completes and
    // immediately sends an initial resize with the true xterm dimensions.
    // That message may arrive before we've spawned the pty (waitForTmux can
    // take seconds on a fresh session while the launcher script boots).
    // Register the message handler up front and buffer anything we can't
    // act on yet — otherwise the initial resize is dropped and the tmux
    // window stays pinned at the 120×40 default until the user manually
    // resizes their browser window.
    let ptyProcess: IPty | null = null;
    // Wrapped in an object so TS control-flow analysis doesn't narrow the
    // value to `never` across the `await` boundary below — mutation happens
    // inside the message-handler closure, which TS can't see through.
    const resize: { value: { cols: number; rows: number } | null } = { value: null };
    const pendingWrites: string[] = [];

    function applyResize(cols: number, rows: number): void {
      if (!ptyProcess) return;
      ptyProcess.resize(cols, rows);
      try {
        execSync(
          `tmux resize-window -t ${tmuxSession} -x ${cols} -y ${rows}`,
          { stdio: 'pipe' },
        );
      } catch {
        // Resize might fail if session is dead
      }
    }

    ws.on('message', (data: Buffer | string) => {
      const msg = typeof data === 'string' ? data : data.toString('utf-8');

      // Check if it's a JSON control message
      if (msg.startsWith('{')) {
        try {
          const ctrl = JSON.parse(msg) as {
            type: string;
            cols?: number;
            rows?: number;
            scrollLines?: number;
          };

          if (ctrl.type === 'resize' && ctrl.cols && ctrl.rows) {
            // Validate cols/rows are integers in a safe range to prevent injection
            const cols = Math.floor(Number(ctrl.cols));
            const rows = Math.floor(Number(ctrl.rows));
            if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || cols > 500 || rows < 1 || rows > 500) {
              return;
            }
            resize.value = { cols, rows };
            applyResize(cols, rows);
            return;
          }

          // Scrollback: capture the full pane history and send it to the
          // client as a control message.  The client renders it in a
          // separate xterm.js instance with native scrollback/selection.
          if (ctrl.type === 'capture-scrollback') {
            const scrollLines = Math.max(1, Math.min(50, Math.floor(Number(ctrl.scrollLines) || 3)));
            try {
              const captured = execSync(
                `tmux capture-pane -p -e -S - -t ${tmuxSession}`,
                { stdio: 'pipe', timeout: 5000, maxBuffer: 10 * 1024 * 1024 },
              ).toString('utf-8');

              // Control messages use a \x00 prefix to distinguish from PTY data
              if (ws.readyState === WebSocket.OPEN) {
                ws.send('\x00' + JSON.stringify({
                  type: 'scrollback',
                  content: captured,
                  scrollLines,
                }));
              }
            } catch (err) {
              console.warn(`[scrollback] capture-pane failed for ${tmuxSession}:`, err);
            }
            return;
          }
        } catch {
          // Not valid JSON, treat as terminal input
        }
      }

      // Write terminal input to the pty — buffer if pty isn't ready yet
      if (ptyProcess) {
        ptyProcess.write(msg);
      } else {
        pendingWrites.push(msg);
      }
    });

    // Handle WebSocket close/error before the pty exists: just clean up.
    let wsClosed = false;
    const onEarlyClose = () => { wsClosed = true; };
    ws.on('close', onEarlyClose);
    ws.on('error', onEarlyClose);

    // Wait for the tmux session to appear — it may still be initialising in the
    // background (worktree creation, git fetch, etc.). Poll up to 30s.
    const tmuxReady = await waitForTmux(tmuxSession);
    if (wsClosed) return;
    if (!tmuxReady) {
      ws.close(1008, 'tmux session not found');
      return;
    }

    // Spawn a pty running `tmux attach-session`.  Use the client's most
    // recent resize (if we've seen one) as the initial pty size so tmux
    // starts at the right dimensions without needing a later round-trip.
    const initCols = resize.value?.cols ?? 120;
    const initRows = resize.value?.rows ?? 40;
    try {
      // Filter out undefined env values that can cause node-pty to fail
      const cleanEnv: { [key: string]: string } = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) cleanEnv[k] = v;
      }
      ptyProcess = pty.spawn(tmuxPath, ['attach-session', '-t', tmuxSession], {
        name: 'xterm-256color',
        cols: initCols,
        rows: initRows,
        env: cleanEnv,
      });
    } catch (err) {
      console.error(`Failed to spawn pty for ${connKey}:`, err);
      ws.close(1011, 'Failed to spawn terminal');
      return;
    }

    // Also explicitly resize the tmux window to match — when tmux has
    // multiple attached clients (or a prior detached-client resize left a
    // stale size), `attach-session` alone won't shrink/grow the window.
    if (resize.value) {
      applyResize(resize.value.cols, resize.value.rows);
    }

    // Flush anything the client sent while we were waiting for tmux.
    for (const msg of pendingWrites) {
      ptyProcess.write(msg);
    }
    pendingWrites.length = 0;

    const connection: PtyConnection = {
      pty: ptyProcess,
      ws,
      tmuxSession,
    };
    const bucket = activePtys.get(connKey);
    if (bucket) bucket.push(connection);
    else activePtys.set(connKey, [connection]);
    if (!connKey.startsWith('auth:')) terminal.viewerAttached(connKey as SessionId);

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
      removePtyConnection(connKey, connection);
      if (ws.readyState !== WebSocket.CLOSED) {
        ws.terminate();
      }
    });

    // Swap the early close/error handlers for the pty-aware versions.
    ws.off('close', onEarlyClose);
    ws.off('error', onEarlyClose);

    // Handle WebSocket close: kill the pty but NOT the tmux session
    ws.on('close', () => {
      dataDisposable.dispose();
      exitDisposable.dispose();
      try {
        ptyProcess!.kill();
      } catch {
        // pty may already be dead
      }
      removePtyConnection(connKey, connection);
    });

    // Handle WebSocket errors — EPIPE and ECONNRESET are expected whenever the
    // client disconnects while the session is still active; only log genuinely
    // unexpected errors.
    ws.on('error', (err: Error & { code?: string }) => {
      dataDisposable.dispose();
      exitDisposable.dispose();
      if (err.code !== 'EPIPE' && err.code !== 'ECONNRESET') {
        console.error(`WebSocket error for ${connKey}:`, err.message);
      }
      try {
        ptyProcess!.kill();
      } catch {
        // pty may already be dead
      }
      removePtyConnection(connKey, connection);
    });
  }
}
