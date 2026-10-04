/**
 * Lazily manages a single shared code-server process, bound to loopback only.
 * Workshop's own auth gates access; code-server itself runs with --auth none.
 */

import { spawn, type ChildProcess } from 'child_process';
import { once } from 'events';
import { existsSync } from 'fs';
import { createServer, connect } from 'net';
import path from 'path';
import { hasCli } from '@infrastructure/launch/launch-apps.js';

const BIN = process.env.WORKSHOP_CODE_SERVER_BIN || 'code-server';

export function isCodeServerAvailable(): boolean {
  return path.isAbsolute(BIN) ? existsSync(BIN) : hasCli(BIN);
}

interface RunningCodeServer {
  port: number;
  child: ChildProcess;
}

let running: RunningCodeServer | null = null;
let starting: Promise<number> | null = null;

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('could not determine a free port'));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });
}

function waitForPort(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error('code-server did not start listening in time'));
          return;
        }
        setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

async function spawnCodeServer(): Promise<number> {
  const port = process.env.WORKSHOP_CODE_SERVER_PORT
    ? parseInt(process.env.WORKSHOP_CODE_SERVER_PORT, 10)
    : await findFreePort();
  const home = process.env.HOME || '/tmp';

  const child = spawn(
    BIN,
    [
      '--auth', 'none',
      '--config', path.join(home, '.workshop', 'code-server', 'config.yaml'),
      '--bind-addr', `127.0.0.1:${port}`,
      '--disable-telemetry',
      '--disable-update-check',
      '--user-data-dir', path.join(home, '.workshop', 'code-server', 'data'),
      '--extensions-dir', path.join(home, '.workshop', 'code-server', 'extensions'),
    ],
    // code-server lets $PORT override --bind-addr, and Workshop's own PORT is set in Docker.
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: String(port) } },
  );

  child.stdout?.on('data', (chunk: Buffer) => console.log(`[code-server] ${chunk.toString().trimEnd()}`));
  child.stderr?.on('data', (chunk: Buffer) => console.error(`[code-server] ${chunk.toString().trimEnd()}`));
  child.on('exit', () => {
    running = null;
  });

  await Promise.race([
    waitForPort(port),
    once(child, 'exit').then(() => { throw new Error('code-server exited during startup'); }),
  ]);
  running = { port, child };
  return port;
}

/** Spawns code-server on first call; later calls reuse the running instance or the in-flight startup. */
export function ensureCodeServer(): Promise<number> {
  if (running) return Promise.resolve(running.port);
  if (!starting) {
    starting = spawnCodeServer().finally(() => {
      starting = null;
    });
  }
  return starting;
}

process.on('exit', () => {
  running?.child.kill();
});
