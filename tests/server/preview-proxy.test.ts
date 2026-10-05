import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { Server } from 'node:http';
import { injectPicker, filterCookieHeader, createPreviewServer } from '@server/preview-proxy.js';

describe('injectPicker', () => {
  it('inserts the script tag right after <head>', () => {
    const html = '<html><head><title>x</title></head><body></body></html>';
    expect(injectPicker(html)).toBe(
      '<html><head><script src="/__workshop/picker.js"></script><title>x</title></head><body></body></html>',
    );
  });

  it('handles a <head> tag with attributes', () => {
    const html = '<html><head lang="en"><title>x</title></head></html>';
    expect(injectPicker(html)).toBe(
      '<html><head lang="en"><script src="/__workshop/picker.js"></script><title>x</title></head></html>',
    );
  });

  it('prepends the script when there is no <head>', () => {
    const html = '<body>hello</body>';
    expect(injectPicker(html)).toBe('<script src="/__workshop/picker.js"></script><body>hello</body>');
  });
});

describe('filterCookieHeader', () => {
  it('drops workshop_token and workshop_preview_target, keeps the rest', () => {
    const header = 'workshop_token=secret; foo=bar; workshop_preview_target=http%3A%2F%2Fx; baz=qux';
    expect(filterCookieHeader(header)).toBe('foo=bar; baz=qux');
  });

  it('returns an empty string when only Workshop cookies are present', () => {
    expect(filterCookieHeader('workshop_token=secret')).toBe('');
  });

  it('leaves unrelated cookies untouched', () => {
    expect(filterCookieHeader('a=1; b=2')).toBe('a=1; b=2');
  });
});

describe('preview proxy integration', () => {
  const TOKEN = 'preview-test-token';
  let upstream: Server;
  let upstreamOrigin: string;
  let preview: Server;
  let previewBase: string;

  beforeAll(async () => {
    process.env.WORKSHOP_AUTH_TOKEN = TOKEN;

    upstream = http.createServer((req, res) => {
      if (req.url === '/api/data') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' }).end(
        `<html><head><title>app</title></head><body>host seen: ${req.headers.host}</body></html>`,
      );
    });
    upstream.listen(0);
    await new Promise<void>((resolve) => upstream.once('listening', resolve));
    const upstreamAddr = upstream.address();
    const upstreamPort = typeof upstreamAddr === 'object' && upstreamAddr ? upstreamAddr.port : 0;
    upstreamOrigin = `http://127.0.0.1:${upstreamPort}`;

    preview = createPreviewServer();
    preview.listen(0);
    await new Promise<void>((resolve) => preview.once('listening', resolve));
    const previewAddr = preview.address();
    const previewPort = typeof previewAddr === 'object' && previewAddr ? previewAddr.port : 0;
    previewBase = `http://127.0.0.1:${previewPort}`;
  });

  afterAll(() => {
    upstream.close();
    preview.close();
    delete process.env.WORKSHOP_AUTH_TOKEN;
  });

  it('rejects requests without a valid token', async () => {
    const res = await fetch(`${previewBase}/anything`);
    expect(res.status).toBe(401);
  });

  it('rejects requests with no preview target cookie', async () => {
    const res = await fetch(`${previewBase}/anything`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Open this preview from Workshop's Preview button");
  });

  it('start sets the target cookie and redirects to path', async () => {
    const res = await fetch(
      `${previewBase}/__workshop/start?target=${encodeURIComponent(upstreamOrigin)}&path=/app`,
      { headers: { authorization: `Bearer ${TOKEN}` }, redirect: 'manual' },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`workshop_preview_target=${encodeURIComponent(upstreamOrigin)}`);
  });

  it('400s on a malformed target', async () => {
    const res = await fetch(`${previewBase}/__workshop/start?target=not-a-url`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(400);
  });

  it('serves the picker script', async () => {
    const res = await fetch(`${previewBase}/__workshop/picker.js`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/javascript');
    expect(await res.text()).toContain('workshop:pick-mode');
  });

  it('proxies HTML, injects the picker tag, and rewrites Host — without forwarding workshop_token', async () => {
    const targetCookie = `workshop_preview_target=${encodeURIComponent(upstreamOrigin)}`;
    const res = await fetch(`${previewBase}/`, {
      headers: { authorization: `Bearer ${TOKEN}`, cookie: `${targetCookie}; workshop_token=${TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('<script src="/__workshop/picker.js"></script>');
    // The upstream server echoes back the Host header it received.
    expect(body).toContain(`host seen: 127.0.0.1`);
    expect(body).not.toContain('workshop_token');
  });

  it('proxies non-HTML responses through untouched', async () => {
    const targetCookie = `workshop_preview_target=${encodeURIComponent(upstreamOrigin)}`;
    const res = await fetch(`${previewBase}/api/data`, {
      headers: { authorization: `Bearer ${TOKEN}`, cookie: targetCookie },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('502s when the target is unreachable', async () => {
    const targetCookie = `workshop_preview_target=${encodeURIComponent('http://127.0.0.1:1')}`;
    const res = await fetch(`${previewBase}/`, {
      headers: { authorization: `Bearer ${TOKEN}`, cookie: targetCookie },
    });
    expect(res.status).toBe(502);
  });
});
