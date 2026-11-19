import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readdirSync, renameSync } from 'fs';
import path from 'path';

const run = promisify(execFile);

/**
 * Move a session workspace (worktrees, uncommitted work, .worktree-meta.json) to `toRoot` in one rename,
 * then re-link each worktree with git. A failed rename moves nothing.
 */
export async function adoptWorktrees(fromRoot: string, toRoot: string): Promise<void> {
  mkdirSync(path.dirname(toRoot), { recursive: true });
  renameSync(fromRoot, toRoot);
  for (const name of readdirSync(toRoot)) {
    const wt = path.join(toRoot, name);
    if (existsSync(path.join(wt, '.git'))) await run('git', ['-C', wt, 'worktree', 'repair']);
  }
}
