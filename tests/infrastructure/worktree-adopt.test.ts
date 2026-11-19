import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { adoptWorktrees } from '@infrastructure/terminal/worktree-adopt.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

describe('adoptWorktrees', () => {
  it('moves worktrees with their uncommitted work and keeps the branch', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'adopt-'));
    const repo = path.join(tmp, 'repo');
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
    const from = path.join(tmp, 'old', 'workspace');
    git(repo, 'worktree', 'add', '-q', path.join(from, 'repo'), '-b', 'feature');
    writeFileSync(path.join(from, 'repo', 'wip.txt'), 'unsaved');
    writeFileSync(path.join(from, '.worktree-meta.json'), '{}'); // cleanup metadata must move with the worktrees

    const to = path.join(tmp, 'new', 'workspace');
    await adoptWorktrees(from, to);

    expect(readFileSync(path.join(to, 'repo', 'wip.txt'), 'utf8')).toBe('unsaved');
    expect(git(path.join(to, 'repo'), 'branch', '--show-current').trim()).toBe('feature');
    expect(existsSync(path.join(to, '.worktree-meta.json'))).toBe(true);
    expect(existsSync(from)).toBe(false);
    expect(git(repo, 'worktree', 'list')).toContain(path.join(to, 'repo'));
  });
});
