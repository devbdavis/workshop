import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFile = promisify(execFileCb);

// Re-export domain interfaces so existing consumers are not broken
export type { GitStatus, GitAdapter } from '@domain/git/types.js';
import type { GitStatus, GitAdapter } from '@domain/git/types.js';

/**
 * Runs a git command in the given directory, returning stdout.
 * Returns null if the command fails (non-zero exit).
 */
async function runGit(
  args: string[],
  cwd: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFile('git', args, { cwd });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * Parses `git status --porcelain` output into modified and untracked counts.
 *
 * Porcelain format: two status characters followed by a space and the file path.
 * - Lines starting with "?" in the first column are untracked.
 * - All other non-empty lines are modified/staged/etc.
 */
function parsePorcelain(output: string): {
  modifiedCount: number;
  untrackedCount: number;
} {
  let modifiedCount = 0;
  let untrackedCount = 0;

  const lines = output.split('\n').filter((l) => l.length > 0);
  for (const line of lines) {
    if (line.startsWith('?')) {
      untrackedCount++;
    } else {
      modifiedCount++;
    }
  }

  return { modifiedCount, untrackedCount };
}

export function createGitAdapter(): GitAdapter {
  return {
    async getStatus(repoPath: string): Promise<GitStatus> {
      // Get current branch
      const branchOutput = await runGit(
        ['branch', '--show-current'],
        repoPath,
      );
      const branch = branchOutput?.trim() || 'HEAD (detached)';

      // Get last commit hash and message
      let lastCommitHash = '';
      let lastCommitMessage = '';
      const logOutput = await runGit(
        ['log', '-1', '--format=%H%n%s'],
        repoPath,
      );
      if (logOutput) {
        const logLines = logOutput.trim().split('\n');
        lastCommitHash = logLines[0] || '';
        lastCommitMessage = logLines[1] || '';
      }

      // Get porcelain status for dirty/modified/untracked
      const statusOutput = await runGit(
        ['status', '--porcelain'],
        repoPath,
      );
      const { modifiedCount, untrackedCount } = parsePorcelain(
        statusOutput || '',
      );
      const dirty = modifiedCount > 0 || untrackedCount > 0;

      // Get remote URL (optional - may not exist)
      const remoteOutput = await runGit(
        ['remote', 'get-url', 'origin'],
        repoPath,
      );
      const remoteUrl = remoteOutput?.trim() || undefined;

      return {
        branch,
        lastCommitHash,
        lastCommitMessage,
        dirty,
        modifiedCount,
        untrackedCount,
        remoteUrl,
      };
    },

    async isGitRepo(path: string): Promise<boolean> {
      const result = await runGit(['rev-parse', '--git-dir'], path);
      return result !== null;
    },
  };
}
