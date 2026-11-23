/**
 * Per-session dev servers: a track's devCommand runs in a detached tmux session
 * (`dev-<sid>`) whose port, log and exit status live in the session's data dir.
 */

import { execFileSync, execSync } from 'child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { findFreePort, isPortOpen } from '@infrastructure/net/ports.js';
import { NIX_CLEAN_TMUX_FLAGS, TMUX_PATH_FLAG } from '@infrastructure/terminal/tmux-flags.js';

export type DevServerState =
  | { state: 'running'; port: number }
  | { state: 'starting' }
  | { state: 'exited'; code: number | null; logTail: string };

export interface EnsureDevServerInput {
  sessionId: string;
  sid: string;
  workingDirectory: string;
  command: string;
}

const LOG_TAIL_LINES = 50;
const RUNNING_CACHE_MS = 5000;

let baseDir = path.join(process.env.HOME || '/tmp', '.workshop', 'sessions');
let startTimeoutMs = 120_000;

/** Test-only: redirect the data dir and shorten the startup timeout. */
export function configureDevServerForTests(opts: { baseDir?: string; startTimeoutMs?: number }): void {
  if (opts.baseDir !== undefined) baseDir = opts.baseDir;
  if (opts.startTimeoutMs !== undefined) startTimeoutMs = opts.startTimeoutMs;
}

const inFlight = new Map<string, Promise<DevServerState>>();
// Every proxied request calls ensureDevServer; this skips its tmux/file/port checks while a server is known up.
const runningCache = new Map<string, { port: number; at: number }>();

function shq(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function files(sessionId: string): Record<'dir' | 'script' | 'log' | 'exit' | 'meta', string> {
  const dir = path.join(baseDir, sessionId);
  return {
    dir,
    script: path.join(dir, 'dev-server.sh'),
    log: path.join(dir, 'dev-server.log'),
    exit: path.join(dir, 'dev-server.exit'),
    meta: path.join(dir, 'dev-server.json'),
  };
}

function isAlive(sid: string): boolean {
  try {
    execFileSync('tmux', ['has-session', '-t', `=dev-${sid}`], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function killTmux(sid: string): void {
  try {
    execFileSync('tmux', ['kill-session', '-t', `=dev-${sid}`], { stdio: 'pipe' });
  } catch {
    // Already gone
  }
}

function readOptional(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readMeta(file: string): { port?: number; startedAt?: number } {
  try {
    return JSON.parse(readOptional(file) ?? '{}') as { port?: number; startedAt?: number };
  } catch {
    return {};
  }
}

function exited(sessionId: string, exitText: string): DevServerState {
  const code = Number(exitText.trim());
  const log = readOptional(files(sessionId).log) ?? '';
  return {
    state: 'exited',
    code: exitText.trim() === 'timeout' || Number.isNaN(code) ? null : code,
    logTail: log.trimEnd().split('\n').slice(-LOG_TAIL_LINES).join('\n'),
  };
}

async function start(input: EnsureDevServerInput): Promise<DevServerState> {
  const f = files(input.sessionId);
  mkdirSync(f.dir, { recursive: true });
  rmSync(f.exit, { force: true });
  rmSync(f.log, { force: true });
  const port = await findFreePort();
  writeFileSync(f.meta, JSON.stringify({ port, startedAt: Date.now() }));
  writeFileSync(
    f.script,
    [
      '#!/usr/bin/env bash',
      'if command -v direnv >/dev/null && [ -f .envrc ]; then eval "$(direnv export bash 2>/dev/null)"; fi',
      `( ${input.command}\n) 2>&1 | tee ${shq(f.log)}`,
      `echo "\${PIPESTATUS[0]}" > ${shq(f.exit)}`,
      '',
    ].join('\n'),
  );
  execSync(
    `tmux new-session -d -s dev-${input.sid} -c ${shq(input.workingDirectory)} ${NIX_CLEAN_TMUX_FLAGS} ${TMUX_PATH_FLAG} -e PORT=${port} ${shq(`bash ${shq(f.script)}`)}`,
    { stdio: 'pipe' },
  );
  return { state: 'starting' };
}

async function ensure(input: EnsureDevServerInput): Promise<DevServerState> {
  const f = files(input.sessionId);
  if (isAlive(input.sid)) {
    const meta = readMeta(f.meta);
    if (meta.port !== undefined && (await isPortOpen(meta.port))) return { state: 'running', port: meta.port };
    if (Date.now() - (meta.startedAt ?? 0) > startTimeoutMs) {
      killTmux(input.sid);
      writeFileSync(f.exit, 'timeout');
      return exited(input.sessionId, 'timeout');
    }
    return { state: 'starting' };
  }
  // The dying script can write the exit file after stop removed it; only meta (written by start) makes it current.
  const exitText = readOptional(f.meta) !== null ? readOptional(f.exit) : null;
  if (exitText !== null) return exited(input.sessionId, exitText);
  return start(input);
}

/** Starts the session's dev server if needed and reports its state; never restarts an exited one. */
export function ensureDevServer(input: EnsureDevServerInput): Promise<DevServerState> {
  const cached = runningCache.get(input.sessionId);
  if (cached && Date.now() - cached.at < RUNNING_CACHE_MS) return Promise.resolve({ state: 'running', port: cached.port });
  let pending = inFlight.get(input.sessionId);
  if (!pending) {
    pending = ensure(input)
      .then((state) => {
        if (state.state === 'running') runningCache.set(input.sessionId, { port: state.port, at: Date.now() });
        return state;
      })
      .finally(() => inFlight.delete(input.sessionId));
    inFlight.set(input.sessionId, pending);
  }
  return pending;
}

export function stopDevServer(sessionId: string, sid: string): void {
  runningCache.delete(sessionId);
  killTmux(sid);
  const f = files(sessionId);
  rmSync(f.exit, { force: true });
  rmSync(f.meta, { force: true });
}
