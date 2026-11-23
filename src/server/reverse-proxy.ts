/**
 * HTTP and WebSocket-upgrade forwarding to a loopback port, shared by the
 * code-server proxy and the per-session dev-server router.
 */

import http from 'http';
import net from 'net';
import type { Request, Response } from 'express';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { validateToken } from './auth-middleware.js';

export interface ProxyOptions {
  /** Forward as a user's dev app: hide Workshop credentials and client-supplied forwarding headers. */
  devHost?: boolean;
}

const WORKSHOP_COOKIES = new Set(['workshop_token', 'workshop_dev']);

function stripCookies(cookie: string): string {
  return cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !WORKSHOP_COOKIES.has(part.split('=')[0]))
    .join('; ');
}

/** Drops only a Workshop `?token=` (an app's own `token` param passes through); the rest of the URL is kept byte-for-byte. */
function stripTokenParam(path: string): string {
  const q = path.indexOf('?');
  if (q < 0) return path;
  const kept = path
    .slice(q + 1)
    .split('&')
    .filter((pair) => !(pair.startsWith('token=') && validateToken(new URLSearchParams(pair).get('token'))));
  return path.slice(0, q) + (kept.length ? `?${kept.join('&')}` : '');
}

/** Rewrites flat `[name, value, ...]` raw headers for a dev app; each name appears once afterwards. */
function devHeaders(rawHeaders: readonly string[], port: number): string[] {
  let originalHost = '';
  let proto = 'http';
  const out: string[] = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i];
    const value = rawHeaders[i + 1];
    const lower = name.toLowerCase();
    if (lower === 'host') {
      originalHost = value;
      out.push(name, `127.0.0.1:${port}`);
    } else if (lower.startsWith('x-forwarded-')) {
      if (lower === 'x-forwarded-proto') proto = value;
    } else if (lower === 'cookie') {
      const cookie = stripCookies(value);
      if (cookie) out.push(name, cookie);
    } else if (lower === 'authorization' && value.startsWith('Bearer ') && validateToken(value.slice(7))) {
      continue;
    } else {
      out.push(name, value);
    }
  }
  out.push('x-forwarded-host', originalHost, 'x-forwarded-proto', proto);
  return out;
}

export function proxyHttp(req: Request, res: Response, port: number, path: string, opts: ProxyOptions = {}): void {
  const headers: http.OutgoingHttpHeaders | string[] = opts.devHost
    ? devHeaders(req.rawHeaders, port)
    : {
        ...req.headers,
        host: `127.0.0.1:${port}`,
        'x-forwarded-proto': req.protocol,
        'x-forwarded-host': req.headers.host ?? '',
      };

  const upstreamReq = http.request(
    { hostname: '127.0.0.1', port, path: opts.devHost ? stripTokenParam(path) : path, method: req.method, headers },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstreamReq.on('error', (err) => {
    console.error('[reverse-proxy] upstream request error:', err);
    if (!res.headersSent) res.status(502).send('Bad gateway');
  });
  req.on('error', () => upstreamReq.destroy());
  req.pipe(upstreamReq);
}

export function proxyUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  port: number,
  path: string,
  opts: ProxyOptions = {},
): void {
  const target = opts.devHost ? stripTokenParam(path) : path;
  const upstream = net.connect(port, '127.0.0.1', () => {
    const raw = opts.devHost ? devHeaders(req.rawHeaders, port) : req.rawHeaders;
    const headerLines: string[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      headerLines.push(`${raw[i]}: ${raw[i + 1]}`);
    }
    upstream.write(`${req.method} ${target} HTTP/1.1\r\n${headerLines.join('\r\n')}\r\n\r\n`);
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
}
