import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCb);

/** Cap git command output — a huge diff would otherwise blow up the response. */
const MAX_GIT_BUFFER = 2 * 1024 * 1024;

export interface ChangedFile {
  /** Repo root, relative to the workspace root ('' for the root itself). */
  repo: string;
  /** File path, relative to the workspace root. */
  path: string;
  /** Two-character porcelain status code (e.g. "M ", "??", "R "). */
  status: string;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd, maxBuffer: MAX_GIT_BUFFER });
  return stdout;
}

/** Git repos directly under `root`: root itself if it has `.git`, else its immediate subdirectories that do. */
export function findGitRepos(root: string): string[] {
  if (existsSync(path.join(root, '.git'))) return [root];
  const repos: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const abs = path.join(root, entry.name);
    // Worktrees carry a `.git` file (not a directory) pointing at the main repo — existsSync covers both.
    if (existsSync(path.join(abs, '.git'))) repos.push(abs);
  }
  return repos;
}

/**
 * Parses `git status --porcelain=v1 -z` output. Rename/copy entries carry an
 * extra NUL-separated original path immediately after, which we consume but don't surface.
 */
function parsePorcelainZ(output: string): Array<{ status: string; path: string }> {
  const tokens = output.split('\0').filter((t) => t.length > 0);
  const result: Array<{ status: string; path: string }> = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    result.push({ status: token.slice(0, 2), path: token.slice(3) });
    if (token[0] === 'R' || token[0] === 'C') i++; // skip the original path
  }
  return result;
}

/** Lists changed/untracked files across every git repo under `root`. */
export async function listChanges(root: string): Promise<ChangedFile[]> {
  const changes: ChangedFile[] = [];
  for (const repoPath of findGitRepos(root)) {
    const repoRel = path.relative(root, repoPath);
    const output = await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], repoPath);
    for (const entry of parsePorcelainZ(output)) {
      changes.push({
        repo: repoRel,
        path: repoRel ? path.join(repoRel, entry.path) : entry.path,
        status: entry.status,
      });
    }
  }
  return changes;
}

/** Finds the git repo (from findGitRepos(root)) containing an absolute file path. */
export function findRepoForFile(root: string, fileAbsPath: string): string | null {
  let best: string | null = null;
  for (const repo of findGitRepos(root)) {
    if (fileAbsPath === repo || fileAbsPath.startsWith(repo + path.sep)) {
      if (!best || repo.length > best.length) best = repo;
    }
  }
  return best;
}

/** Unified diff for one file: tracked changes against HEAD, or a synthetic diff for untracked files. */
export async function diffFile(repoPath: string, repoRelPath: string): Promise<string> {
  const tracked = await runGit(['diff', 'HEAD', '--', repoRelPath], repoPath).catch(() => '');
  if (tracked.trim().length > 0) return tracked;

  const status = await runGit(['status', '--porcelain=v1', '--', repoRelPath], repoPath).catch(() => '');
  if (!status.startsWith('??')) return tracked;

  try {
    const { stdout } = await execFile('git', ['diff', '--no-index', '--', '/dev/null', repoRelPath], {
      cwd: repoPath,
      maxBuffer: MAX_GIT_BUFFER,
    });
    return stdout;
  } catch (err) {
    // `--no-index` exits 1 when it finds a difference — normal here; stdout still carries the diff.
    if (err && typeof err === 'object' && 'stdout' in err) return (err as { stdout: string }).stdout;
    throw err;
  }
}
