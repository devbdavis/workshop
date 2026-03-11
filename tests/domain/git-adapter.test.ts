import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createGitAdapter } from '@infrastructure/git/git-adapter.js';

const execFile = promisify(execFileCb);

/** Helper to run git commands in a directory. */
async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout;
}

describe('GitAdapter', () => {
  let tempDir: string;
  const adapter = createGitAdapter();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'git-adapter-test-'));
    // Initialize a repo with an initial commit
    await git(['init'], tempDir);
    await git(['config', 'user.email', 'test@test.com'], tempDir);
    await git(['config', 'user.name', 'Test User'], tempDir);
    await writeFile(join(tempDir, 'README.md'), '# Test\n');
    await git(['add', '.'], tempDir);
    await git(['commit', '-m', 'Initial commit'], tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('isGitRepo', () => {
    it('returns true for a git repository', async () => {
      expect(await adapter.isGitRepo(tempDir)).toBe(true);
    });

    it('returns false for a non-git directory', async () => {
      const nonGitDir = await mkdtemp(join(tmpdir(), 'not-git-'));
      try {
        expect(await adapter.isGitRepo(nonGitDir)).toBe(false);
      } finally {
        await rm(nonGitDir, { recursive: true, force: true });
      }
    });

    it('returns false for a non-existent path', async () => {
      expect(
        await adapter.isGitRepo('/tmp/does-not-exist-12345'),
      ).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('returns correct branch name', async () => {
      const status = await adapter.getStatus(tempDir);
      // Default branch could be main or master depending on git config
      expect(['main', 'master']).toContain(status.branch);
    });

    it('returns last commit hash and message', async () => {
      const status = await adapter.getStatus(tempDir);
      expect(status.lastCommitHash).toMatch(/^[0-9a-f]{40}$/);
      expect(status.lastCommitMessage).toBe('Initial commit');
    });

    it('reports clean state when no changes', async () => {
      const status = await adapter.getStatus(tempDir);
      expect(status.dirty).toBe(false);
      expect(status.modifiedCount).toBe(0);
      expect(status.untrackedCount).toBe(0);
    });

    it('detects modified files', async () => {
      await writeFile(join(tempDir, 'README.md'), '# Modified\n');
      const status = await adapter.getStatus(tempDir);
      expect(status.dirty).toBe(true);
      expect(status.modifiedCount).toBe(1);
      expect(status.untrackedCount).toBe(0);
    });

    it('detects untracked files', async () => {
      await writeFile(join(tempDir, 'new-file.txt'), 'hello\n');
      const status = await adapter.getStatus(tempDir);
      expect(status.dirty).toBe(true);
      expect(status.modifiedCount).toBe(0);
      expect(status.untrackedCount).toBe(1);
    });

    it('detects both modified and untracked files', async () => {
      await writeFile(join(tempDir, 'README.md'), '# Changed\n');
      await writeFile(join(tempDir, 'extra.txt'), 'extra\n');
      const status = await adapter.getStatus(tempDir);
      expect(status.dirty).toBe(true);
      expect(status.modifiedCount).toBe(1);
      expect(status.untrackedCount).toBe(1);
    });

    it('reports no remote when none is configured', async () => {
      const status = await adapter.getStatus(tempDir);
      expect(status.remoteUrl).toBeUndefined();
    });

    it('detects branch change after checkout', async () => {
      await git(['checkout', '-b', 'feature-branch'], tempDir);
      const status = await adapter.getStatus(tempDir);
      expect(status.branch).toBe('feature-branch');
    });

    it('includes staged files in modified count', async () => {
      await writeFile(join(tempDir, 'staged.txt'), 'staged\n');
      await git(['add', 'staged.txt'], tempDir);
      const status = await adapter.getStatus(tempDir);
      expect(status.dirty).toBe(true);
      // Staged new file shows as "A " in porcelain (not "??"), so it's a modified count
      expect(status.modifiedCount).toBe(1);
    });
  });
});
