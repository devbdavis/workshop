import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { stripPrefix, createCodeServerProxy } from '@server/code-server-proxy.js';

describe('stripPrefix', () => {
  it('reduces the bare /code mount to the root path', () => {
    expect(stripPrefix('/code')).toBe('/');
  });

  it('strips the prefix while keeping the rest of the path', () => {
    expect(stripPrefix('/code/')).toBe('/');
    expect(stripPrefix('/code/healthz')).toBe('/healthz');
  });

  it('preserves the query string', () => {
    expect(stripPrefix('/code/foo?bar=1')).toBe('/foo?bar=1');
  });
});

describe('code-server proxy middleware', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(createCodeServerProxy().middleware);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('passes through requests outside the /code prefix', async () => {
    const app2 = express();
    app2.use(createCodeServerProxy().middleware);
    app2.get('/other', (_req, res) => res.status(200).send('ok'));
    const srv = app2.listen(0);
    await new Promise<void>((resolve) => srv.once('listening', resolve));
    const addr = srv.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/other`);
    expect(res.status).toBe(200);
    srv.close();
  });

  it('rejects /code/* requests without a valid token', async () => {
    const res = await fetch(`${base}/code/`, { redirect: 'manual' });
    expect(res.status).toBe(401);
  });

  it('redirects the bare /code path to /code/ before checking auth', async () => {
    const res = await fetch(`${base}/code?foo=1`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/code/?foo=1');
  });
});
