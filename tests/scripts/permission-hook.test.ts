import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';

const script = path.resolve(__dirname, '../../scripts/permission-hook.mjs');
let server: http.Server;
let url: string;
let seen: { url?: string; session?: string; body?: string } = {};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen = { url: req.url, session: req.headers['x-workshop-session'] as string, body };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ decision: 'allow' }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

function run(mode: string, apiUrl: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, mode], {
      env: {
        ...process.env,
        WORKSHOP_API_URL: apiUrl,
        WORKSHOP_SESSION_ID: 's-1',
        WORKSHOP_AUTH_TOKEN: 't',
      },
    });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.on('close', (code) => resolve({ code, out }));
    child.stdin.end(
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, reason: 'r' }),
    );
  });
}

describe('permission-hook.mjs', () => {
  it('claude-denied retries on allow', async () => {
    const r = await run('claude-denied', url);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionDenied', retry: true },
    });
    expect(seen.url).toBe('/api/permissions/requests');
    expect(seen.session).toBe('s-1');
    expect(JSON.parse(seen.body!)).toMatchObject({
      harness: 'claude',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      reason: 'r',
    });
  });

  it('codex-request allows', async () => {
    const r = await run('codex-request', url);
    expect(JSON.parse(r.out)).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
  });

  it('claude-pretool and gemini-before-tool hit /check', async () => {
    expect(
      JSON.parse((await run('claude-pretool', url)).out).hookSpecificOutput.permissionDecision,
    ).toBe('allow');
    expect(seen.url).toBe('/api/permissions/check');
    expect(JSON.parse((await run('gemini-before-tool', url)).out)).toEqual({ decision: 'allow' });
  });

  it('fails open when the server is down', async () => {
    const r = await run('claude-denied', 'http://127.0.0.1:1');
    expect(r).toEqual({ code: 0, out: '' });
  });
});
