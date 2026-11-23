import { execFile as execFileCb } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { findGitRepos } from './workspace-git.js';

const execFile = promisify(execFileCb);
const MAX_LINES = 40;
const GIT_TIMEOUT_MS = 10_000;

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS });
    const lines = stdout.trim().split('\n');
    const clipped = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `… (${lines.length - MAX_LINES} more lines)`] : lines;
    return clipped.join('\n');
  } catch {
    return null; // a failing git call just drops that section from the brief
  }
}

async function snapshotRepo(repo: string, label: string): Promise<string> {
  const [branch, status, log, diff] = await Promise.all([
    git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(repo, ['status', '--short']),
    git(repo, ['log', '--oneline', '-10']),
    git(repo, ['diff', '--stat', 'HEAD']),
  ]);
  const parts = [`### ${label}${branch ? ` (branch ${branch})` : ''}`];
  if (status) parts.push(`Status:\n${status}`);
  if (diff) parts.push(`Diff vs HEAD:\n${diff}`);
  if (log) parts.push(`Recent commits:\n${log}`);
  return parts.join('\n\n');
}

/** Markdown summary of git state for `cwd` or, for workspace dirs, each repo directly under it. Null when none found. */
export async function snapshotGitState(cwd: string): Promise<string | null> {
  let repos: string[];
  try {
    repos = findGitRepos(cwd);
  } catch {
    return null;
  }
  if (repos.length === 0) return null;
  const sections = await Promise.all(repos.map((r) => snapshotRepo(r, path.basename(r))));
  return sections.join('\n\n');
}
