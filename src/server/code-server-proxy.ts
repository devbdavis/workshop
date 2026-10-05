/**
 * Reverse proxy for code-server, mounted at /code behind Workshop's own auth
 * so a full browser VS Code is reachable through Workshop's single port.
 */

import http from 'http';
import net from 'net';
import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { extractToken, validateToken } from './auth-middleware.js';
import { ensureCodeServer, isCodeServerAvailable } from '@infrastructure/code-server/code-server.js';

const PREFIX = '/code';

/** Strips the `/code` mount prefix from a request URL, preserving the query string. */
export function stripPrefix(url: string): string {
  const stripped = url.slice(PREFIX.length);
  return stripped === '' ? '/' : stripped;
}

export interface CodeServerProxy {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
}

export function createCodeServerProxy(): CodeServerProxy {
  function middleware(req: Request, res: Response, next: NextFunction): void {
    if (req.path !== PREFIX && !req.path.startsWith(`${PREFIX}/`)) {
      next();
      return;
    }

    if (req.path === PREFIX) {
      const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      res.redirect(302, `${PREFIX}/${query}`);
      return;
    }

    if (!validateToken(extractToken(req))) {
      res.status(401).type('text/plain').send('Authentication required');
      return;
    }

    if (!isCodeServerAvailable()) {
      res.status(503).type('text/plain').send(
        'code-server is not installed. Install it, or set WORKSHOP_CODE_SERVER_BIN to its path.',
      );
      return;
    }

    void proxyRequest(req, res);
  }

  async function proxyRequest(req: Request, res: Response): Promise<void> {
    let port: number;
    try {
      port = await ensureCodeServer();
    } catch (err) {
      console.error('[code-server-proxy] failed to start code-server:', err);
      if (!res.headersSent) res.status(502).send('Failed to start code-server');
      return;
    }

    const headers: http.OutgoingHttpHeaders = {
      ...req.headers,
      host: `127.0.0.1:${port}`,
      'x-forwarded-proto': req.protocol,
      'x-forwarded-host': req.headers.host ?? '',
    };

    const upstreamReq = http.request(
      { hostname: '127.0.0.1', port, path: stripPrefix(req.originalUrl), method: req.method, headers },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstreamReq.on('error', (err) => {
      console.error('[code-server-proxy] upstream request error:', err);
      if (!res.headersSent) res.status(502).send('Bad gateway');
    });
    req.on('error', () => upstreamReq.destroy());
    req.pipe(upstreamReq);
  }

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = req.url ?? '';
    if (!url.startsWith(`${PREFIX}/`)) return false;

    void (async () => {
      let port: number;
      try {
        port = await ensureCodeServer();
      } catch (err) {
        console.error('[code-server-proxy] failed to start code-server:', err);
        socket.destroy();
        return;
      }

      const upstream = net.connect(port, '127.0.0.1', () => {
        const headerLines: string[] = [];
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          headerLines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
        }
        upstream.write(`${req.method} ${stripPrefix(url)} HTTP/1.1\r\n${headerLines.join('\r\n')}\r\n\r\n`);
        upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });

      const cleanup = (): void => {
        upstream.destroy();
        socket.destroy();
      };
      upstream.on('error', cleanup);
      upstream.on('close', cleanup);
      socket.on('error', cleanup);
      socket.on('close', cleanup);
    })();

    return true;
  }

  return { middleware, handleUpgrade };
}
