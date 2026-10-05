/**
 * Preview listener — a second HTTP(S)+WS server, on its own origin (a different
 * port), that proxies the user's dev server (e.g. Vite on :5173) so it renders
 * at root with absolute asset paths and a working HMR websocket. Mounting it
 * under Workshop's own port/prefix would break both of those.
 */

import http from 'http';
import https from 'https';
import net from 'net';
import tls from 'tls';
import { readFileSync } from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Duplex } from 'stream';
import { extractToken, validateToken, parseCookie } from './auth-middleware.js';

const START_PATH = '/__workshop/start';
const PICKER_PATH = '/__workshop/picker.js';
const TARGET_COOKIE = 'workshop_preview_target';
const TOKEN_COOKIE = 'workshop_token';
const NO_TARGET_MESSAGE = "Open this preview from Workshop's Preview button";

const PICKER_SCRIPT = readFileSync(new URL('./preview-picker.js', import.meta.url), 'utf-8');

/** `WORKSHOP_PREVIEW_PORT`, defaulting to the main server port + 100. */
export function getPreviewPort(): number {
  const mainPort = parseInt(process.env.PORT || '3001', 10);
  return parseInt(process.env.WORKSHOP_PREVIEW_PORT || String(mainPort + 100), 10);
}

/** Strips Workshop's own cookies from a Cookie header before forwarding it upstream. */
export function filterCookieHeader(cookieHeader: string): string {
  return cookieHeader
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => !pair.startsWith(`${TOKEN_COOKIE}=`) && !pair.startsWith(`${TARGET_COOKIE}=`))
    .join('; ');
}

/** Injects the picker <script> tag right after the opening <head>, or prepends it if there is none. */
export function injectPicker(html: string): string {
  const scriptTag = `<script src="${PICKER_PATH}"></script>`;
  const headMatch = html.match(/<head[^>]*>/i);
  if (!headMatch) return scriptTag + html;
  const insertAt = html.indexOf(headMatch[0]) + headMatch[0].length;
  return html.slice(0, insertAt) + scriptTag + html.slice(insertAt);
}

/** Reads the target origin set by /__workshop/start, validated as http(s). */
function getTargetOrigin(req: IncomingMessage): string | null {
  const raw = parseCookie(req.headers.cookie, TARGET_COOKIE);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function handleStart(url: URL, res: ServerResponse): void {
  const targetParam = url.searchParams.get('target');
  const pathParam = url.searchParams.get('path') ?? '/';
  if (!targetParam || !pathParam.startsWith('/')) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('target and an absolute path are required');
    return;
  }

  let target: URL;
  try {
    target = new URL(targetParam);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('target must be a valid URL');
    return;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('target must be http or https');
    return;
  }

  res.writeHead(302, {
    'set-cookie': `${TARGET_COOKIE}=${encodeURIComponent(target.origin)}; Path=/; HttpOnly; SameSite=Lax`,
    location: pathParam,
  }).end();
}

/** Streams the upstream response through, injecting the picker script into HTML bodies. */
function relayResponse(upstreamRes: IncomingMessage, res: ServerResponse): void {
  // Aborted streams emit error; unhandled, that would take down Workshop with it.
  upstreamRes.on('error', () => res.destroy());
  res.on('error', () => upstreamRes.destroy());
  const headers = { ...upstreamRes.headers };
  delete headers['x-frame-options'];
  delete headers['content-security-policy'];

  const contentType = upstreamRes.headers['content-type'] ?? '';
  if (!contentType.includes('text/html')) {
    res.writeHead(upstreamRes.statusCode ?? 200, headers);
    upstreamRes.pipe(res);
    return;
  }

  const chunks: Buffer[] = [];
  upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk));
  upstreamRes.on('end', () => {
    const html = injectPicker(Buffer.concat(chunks).toString('utf-8'));
    delete headers['content-length'];
    res.writeHead(upstreamRes.statusCode ?? 200, headers);
    res.end(html);
  });
}

function proxyRequest(req: IncomingMessage, res: ServerResponse, originStr: string): void {
  const origin = new URL(originStr);
  const isHttps = origin.protocol === 'https:';
  const client = isHttps ? https : http;

  const headers: http.OutgoingHttpHeaders = { ...req.headers };
  headers.host = origin.host;
  headers['accept-encoding'] = 'identity';
  if (typeof headers.cookie === 'string') {
    const filtered = filterCookieHeader(headers.cookie);
    if (filtered) headers.cookie = filtered;
    else delete headers.cookie;
  }

  const upstreamReq = client.request(
    {
      hostname: origin.hostname,
      port: origin.port || (isHttps ? 443 : 80),
      path: req.url,
      method: req.method,
      headers,
    },
    (upstreamRes) => relayResponse(upstreamRes, res),
  );
  upstreamReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain' }).end(`Dev server not reachable at ${originStr}`);
    }
  });
  req.on('error', () => upstreamReq.destroy());
  req.pipe(upstreamReq);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!validateToken(extractToken(req))) {
    res.writeHead(401, { 'content-type': 'text/plain' }).end('Authentication required');
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  if (url.pathname === START_PATH) {
    handleStart(url, res);
    return;
  }

  if (url.pathname === PICKER_PATH) {
    res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-cache' }).end(PICKER_SCRIPT);
    return;
  }

  const targetOrigin = getTargetOrigin(req);
  if (!targetOrigin) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end(NO_TARGET_MESSAGE);
    return;
  }

  proxyRequest(req, res, targetOrigin);
}

function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  if (!validateToken(extractToken(req))) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  const targetOrigin = getTargetOrigin(req);
  if (!targetOrigin) {
    socket.destroy();
    return;
  }

  const origin = new URL(targetOrigin);
  const isHttps = origin.protocol === 'https:';
  const port = origin.port ? Number(origin.port) : isHttps ? 443 : 80;

  const onReady = (): void => {
    const headerLines: string[] = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      let value = req.rawHeaders[i + 1];
      const lower = name.toLowerCase();
      if (lower === 'host') value = origin.host;
      else if (lower === 'cookie') value = filterCookieHeader(value);
      headerLines.push(`${name}: ${value}`);
    }
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headerLines.join('\r\n')}\r\n\r\n`);
    upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  };

  const upstream: Duplex = isHttps
    ? tls.connect({ host: origin.hostname, port }, onReady)
    : net.connect(port, origin.hostname, onReady);

  const cleanup = (): void => {
    upstream.destroy();
    socket.destroy();
  };
  upstream.on('error', cleanup);
  upstream.on('close', cleanup);
  socket.on('error', cleanup);
  socket.on('close', cleanup);
}

/** Creates the preview listener (not yet bound to a port — call `.listen()`). */
export function createPreviewServer(): http.Server {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(400, { 'content-type': 'text/plain' }).end('Bad request');
      else res.destroy();
    });
  });
  server.on('upgrade', handleUpgrade);
  return server;
}
