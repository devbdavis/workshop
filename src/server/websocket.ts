import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn } from 'child_process';
import type { IncomingMessage } from 'http';
import { createSessionRepository } from '@infrastructure/persistence/session-repository.js';
import type { SessionId } from '@foundation/types';

export function setupWebSocket(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });
  const sessions = createSessionRepository();

  server.on('upgrade', (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
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

  function handleTerminalConnection(ws: WebSocket, sessionId: SessionId): void {
    const session = sessions.findById(sessionId);
    if (!session) {
      ws.close(1008, 'Session not found');
      return;
    }

    // Attach to the tmux session via a pty-like mechanism
    // We spawn `tmux attach` and pipe I/O through the WebSocket
    const tmuxProc = spawn('tmux', ['attach-session', '-t', session.tmuxSession], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    tmuxProc.stdout?.on('data', (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    tmuxProc.stderr?.on('data', (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    ws.on('message', (data: Buffer | string) => {
      const msg = data.toString();

      // Check if it's a control message (JSON)
      if (msg.startsWith('{')) {
        try {
          const ctrl = JSON.parse(msg);
          if (ctrl.type === 'resize' && ctrl.cols && ctrl.rows) {
            // Resize the tmux pane
            try {
              const { execSync } = require('child_process');
              execSync(
                `tmux resize-window -t ${session.tmuxSession} -x ${ctrl.cols} -y ${ctrl.rows}`,
                { stdio: 'pipe' },
              );
            } catch {
              // Resize might fail if session is dead
            }
            return;
          }
        } catch {
          // Not JSON, treat as terminal input
        }
      }

      tmuxProc.stdin?.write(data);
    });

    ws.on('close', () => {
      tmuxProc.kill();
    });

    tmuxProc.on('exit', () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });
  }
}
