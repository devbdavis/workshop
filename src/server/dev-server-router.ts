/**
 * Owns every request whose Host is a per-session dev hostname: authenticates it
 * with a signed cookie, starts the session's dev server on demand, and proxies to it.
 */

import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import type { SessionRepository } from '@domain/session/repository.js';
import type { TrackRepository } from '@domain/track/repository.js';
import type { Session } from '@foundation/types';
import { devSid } from '@foundation/dev-sid.js';
import { ensureDevServer, stopDevServer, type DevServerState } from '@infrastructure/dev-server/dev-server.js';
import { parseCookie } from './auth-middleware.js';
import { parseDevHost, signDevTicket, verifyDevTicket } from './dev-host.js';
import { proxyHttp, proxyUpgrade } from './reverse-proxy.js';

const COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface DevServerRouter {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
}

interface Deps {
  domain: string;
  sessions: SessionRepository;
  tracks: TrackRepository;
}

interface Target {
  session: Session;
  command: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function page(res: Response, status: number, body: string, refresh = false): void {
  const head = refresh ? '<meta http-equiv="refresh" content="2">' : '';
  res.status(status).type('html').send(`<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`);
}

function exitedPage(res: Response, state: Extract<DevServerState, { state: 'exited' }>): void {
  const why = state.code === null ? 'timed out' : `exited with code ${state.code}`;
  page(
    res,
    502,
    `<h1>Dev server ${why}</h1><pre>${escapeHtml(state.logTail)}</pre><p><a href="/__workshop/retry">Retry</a></p>`,
  );
}

export function createDevServerRouter({ domain, sessions, tracks }: Deps): DevServerRouter {
  function findTarget(sidValue: string): Target | 'no-session' | 'no-command' {
    const session = sessions.findAll().find((s) => !s.deletedAt && devSid(s.id) === sidValue);
    if (!session) return 'no-session';
    const command = tracks.findById(session.trackId)?.devCommand?.trim();
    return command ? { session, command } : 'no-command';
  }

  function ensure(target: Target, sidValue: string): Promise<DevServerState> {
    return ensureDevServer({
      sessionId: target.session.id,
      sid: sidValue,
      workingDirectory: target.session.workingDirectory ?? target.session.worktreeRoot ?? process.cwd(),
      command: target.command,
    });
  }

  function middleware(req: Request, res: Response, next: NextFunction): void {
    const sidValue = parseDevHost(req.headers.host, domain);
    if (!sidValue) {
      next();
      return;
    }
    handle(req, res, sidValue).catch((err: unknown) => {
      console.error('[dev-server-router] request failed:', err);
      if (!res.headersSent) page(res, 400, 'Bad request.');
      else res.destroy();
    });
  }

  async function handle(req: Request, res: Response, sidValue: string): Promise<void> {
    const url = new URL('http://x' + req.url);

    if (url.pathname === '/__workshop/auth') {
      const ticket = url.searchParams.get('t');
      if (!verifyDevTicket(ticket, sidValue)) {
        page(res, 401, 'Open this dev server from the Dev Server button in Workshop.');
        return;
      }
      res.cookie('workshop_dev', signDevTicket(sidValue, COOKIE_TTL_SECONDS), {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: req.get('x-forwarded-proto')?.split(',')[0].trim() === 'https',
        maxAge: COOKIE_TTL_SECONDS * 1000,
      });
      res.redirect(302, '/');
      return;
    }

    if (!verifyDevTicket(parseCookie(req.headers.cookie, 'workshop_dev'), sidValue)) {
      page(res, 401, 'Open this dev server from the Dev Server button in Workshop.');
      return;
    }

    const target = findTarget(sidValue);
    if (target === 'no-session') {
      page(res, 404, 'Session not found.');
      return;
    }
    if (target === 'no-command') {
      page(res, 404, 'No dev command set for this track');
      return;
    }

    if (url.pathname === '/__workshop/retry') {
      stopDevServer(target.session.id, sidValue);
      res.redirect(302, '/');
      return;
    }

    let state: DevServerState;
    try {
      state = await ensure(target, sidValue);
    } catch (err) {
      console.error('[dev-server-router] failed to start dev server:', err);
      page(res, 502, 'Failed to start the dev server.');
      return;
    }

    if (state.state === 'running') {
      proxyHttp(req, res, state.port, req.originalUrl, { devHost: true });
    } else if (state.state === 'starting') {
      if (req.method === 'GET' && req.headers.accept?.includes('text/html')) {
        page(res, 503, '<h1>Starting dev server…</h1>', true);
      } else {
        res.status(503).type('text/plain').send('Starting dev server');
      }
    } else {
      exitedPage(res, state);
    }
  }

  function reject(socket: Duplex, status: string): void {
    socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
    socket.destroy();
  }

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const sidValue = parseDevHost(req.headers.host, domain);
    if (!sidValue) return false;

    socket.on('error', () => socket.destroy());
    void (async () => {
      if (!verifyDevTicket(parseCookie(req.headers.cookie, 'workshop_dev'), sidValue)) {
        reject(socket, '401 Unauthorized');
        return;
      }
      const target = findTarget(sidValue);
      if (typeof target === 'string') {
        reject(socket, '404 Not Found');
        return;
      }
      try {
        const state = await ensure(target, sidValue);
        if (state.state !== 'running') {
          reject(socket, '503 Service Unavailable');
          return;
        }
        proxyUpgrade(req, socket, head, state.port, req.url ?? '/', { devHost: true });
      } catch (err) {
        console.error('[dev-server-router] upgrade failed:', err);
        reject(socket, '503 Service Unavailable');
      }
    })();
    return true;
  }

  return { middleware, handleUpgrade };
}
