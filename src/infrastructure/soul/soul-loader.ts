import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export interface SoulLoader {
  /** Load soul content. Reads fresh from disk each call (edits take effect without restart). */
  load(): string;
  /** Save content to the user soul path (~/.workshop/soul.md). Creates directory if needed. */
  save(content: string): void;
  /** Get metadata about current soul state */
  getInfo(): { content: string; source: 'user' | 'default' | 'none'; userPath: string; defaultPath: string };
  /** Delete user override, falling back to default */
  reset(): void;
}

export function createSoulLoader(projectRoot: string): SoulLoader {
  const homeDir = process.env.HOME || '/tmp';
  const userPath = path.join(homeDir, '.workshop', 'soul.md');
  const defaultPath = path.join(projectRoot, 'soul.md');

  function load(): string {
    // 1. User override takes priority
    if (existsSync(userPath)) {
      try {
        return readFileSync(userPath, 'utf-8');
      } catch {
        // Fall through to default
      }
    }

    // 2. Default shipped with repo
    if (existsSync(defaultPath)) {
      try {
        return readFileSync(defaultPath, 'utf-8');
      } catch {
        // Fall through to empty
      }
    }

    // 3. Graceful degradation
    return '';
  }

  function save(content: string): void {
    const dir = path.dirname(userPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(userPath, content, 'utf-8');
  }

  function getInfo(): { content: string; source: 'user' | 'default' | 'none'; userPath: string; defaultPath: string } {
    let content = '';
    let source: 'user' | 'default' | 'none' = 'none';

    if (existsSync(userPath)) {
      try {
        content = readFileSync(userPath, 'utf-8');
        source = 'user';
      } catch {
        // Fall through
      }
    }

    if (source === 'none' && existsSync(defaultPath)) {
      try {
        content = readFileSync(defaultPath, 'utf-8');
        source = 'default';
      } catch {
        // Fall through
      }
    }

    return { content, source, userPath, defaultPath };
  }

  function reset(): void {
    if (existsSync(userPath)) {
      try {
        unlinkSync(userPath);
      } catch {
        // Ignore errors
      }
    }
  }

  return { load, save, getInfo, reset };
}
