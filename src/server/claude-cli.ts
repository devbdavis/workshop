import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';

/**
 * Locate the `claude` CLI binary.
 *
 * The Workshop server is typically launched from a desktop shortcut, launchd,
 * or `npm run dev` — none of which inherit the user's interactive shell PATH.
 * In particular, the official Claude installer puts the binary at
 * `~/.local/bin/claude`, and that directory is rarely on the server-process
 * PATH on macOS or Linux. The result was a "claude: command not found" error
 * surfacing in the UI as "make sure claude is available" — even when it
 * clearly was, just not visible to the server.
 *
 * Resolution strategy (first hit wins, cached for the process lifetime):
 *   1. `command -v claude` in case it's already on PATH (covers everyone
 *      who launched Workshop from a normal shell or set PATH explicitly).
 *   2. Common install locations — `~/.local/bin/claude` (official installer),
 *      `~/.claude/local/claude` (older installer), `/usr/local/bin/claude`,
 *      `/opt/homebrew/bin/claude` (Homebrew on Apple Silicon).
 *   3. `null` — caller surfaces a precise error to the UI.
 */
let claudeBinaryCache: string | null | undefined;

export function resolveClaudeBinary(): string | null {
  if (claudeBinaryCache !== undefined) return claudeBinaryCache;

  // 1. Already on PATH
  try {
    const out = execSync('command -v claude', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim();
    if (out && existsSync(out)) {
      claudeBinaryCache = out;
      return out;
    }
  } catch {
    // not on PATH — fall through to candidate scan
  }

  // 2. Common install locations
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'local', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      claudeBinaryCache = candidate;
      return candidate;
    }
  }

  claudeBinaryCache = null;
  return null;
}

/** Reset the resolver cache. Test-only. */
export function _resetClaudeBinaryCache(): void {
  claudeBinaryCache = undefined;
}

/** Distinguishable error class so callers can tell "missing CLI" from
 *  "CLI ran but failed", and the UI can show a precise message. */
export class ClaudeBinaryNotFoundError extends Error {
  constructor() {
    super(
      'claude CLI not found. Install Claude Code (https://docs.claude.com/claude-code) ' +
        'or add the binary to the workshop server\'s PATH.',
    );
    this.name = 'ClaudeBinaryNotFoundError';
  }
}

/**
 * Call the local `claude` CLI in print mode.
 *
 * Uses the user's existing CLI auth — no ANTHROPIC_API_KEY needed. Resolves
 * the binary via {@link resolveClaudeBinary} so we work even when the server
 * was started without `~/.local/bin` on PATH.
 *
 * Throws {@link ClaudeBinaryNotFoundError} if the CLI can't be located.
 * Otherwise rejects with whatever stderr / exit-code error claude produces.
 */
export function callClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const binary = resolveClaudeBinary();
    if (!binary) {
      reject(new ClaudeBinaryNotFoundError());
      return;
    }

    const child = spawn(binary, ['-p', prompt]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Claude CLI timed out after 120s'));
    }, 120_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            Buffer.concat(err).toString().trim() || `claude exited with code ${code}`,
          ),
        );
      } else {
        resolve(Buffer.concat(out).toString());
      }
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/**
 * Extract a single JSON object from arbitrary text. Used to pull structured
 * output out of `claude -p` responses, which often include surrounding prose.
 */
export function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in Claude response');
  return JSON.parse(match[0]);
}
