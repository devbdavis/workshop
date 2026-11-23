import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { execSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { ensureDevServer, stopDevServer, configureDevServerForTests, type DevServerState } from '@infrastructure/dev-server/dev-server.js';

function has(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const SERVE = 'python3 -m http.server $PORT --bind 127.0.0.1';

describe.skipIf(!has('tmux') || !has('python3'))('dev server', () => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'dev-server-test-'));
  const started: Array<[string, string]> = [];

  function input(n: string, command: string) {
    started.push([`sess-${n}`, `aaaaaaaa000${n}`]);
    return { sessionId: `sess-${n}`, sid: `aaaaaaaa000${n}`, workingDirectory: base, command };
  }

  async function until(fn: () => Promise<DevServerState>, want: DevServerState['state']): Promise<DevServerState> {
    for (let i = 0; i < 100; i++) {
      const s = await fn();
      if (s.state === want) return s;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`never reached ${want}`);
  }

  beforeAll(() => configureDevServerForTests({ baseDir: base }));
  afterAll(() => {
    for (const [sessionId, sid] of started) stopDevServer(sessionId, sid);
    rmSync(base, { recursive: true, force: true });
  });

  it('starts, becomes running, keeps its port, and stops', async () => {
    const i = input('1', SERVE);
    expect((await ensureDevServer(i)).state).toBe('starting');
    const running = await until(() => ensureDevServer(i), 'running');
    const again = await ensureDevServer(i);
    expect(again).toEqual(running);
    stopDevServer(i.sessionId, i.sid);
    expect(() => execSync(`tmux has-session -t =dev-${i.sid}`, { stdio: 'pipe' })).toThrow();
  });

  it('starts once for concurrent ensures', async () => {
    const i = input('2', SERVE);
    const results = await Promise.all([ensureDevServer(i), ensureDevServer(i), ensureDevServer(i)]);
    expect(results.every((r) => r.state === 'starting')).toBe(true);
    await until(() => ensureDevServer(i), 'running');
  });

  it('reports exit code and log tail', async () => {
    const i = input('3', 'echo boom; exit 3');
    await ensureDevServer(i);
    const state = await until(() => ensureDevServer(i), 'exited');
    expect(state).toMatchObject({ state: 'exited', code: 3 });
    expect((state as Extract<DevServerState, { state: 'exited' }>).logTail).toContain('boom');
  });

  it('ignores a stale exit file left without dev-server.json', async () => {
    const i = input('4', SERVE);
    mkdirSync(path.join(base, i.sessionId), { recursive: true });
    writeFileSync(path.join(base, i.sessionId, 'dev-server.exit'), '9');
    expect((await ensureDevServer(i)).state).toBe('starting');
  });
});
