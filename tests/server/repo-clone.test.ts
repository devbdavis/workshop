import { describe, it, expect } from 'vitest';
import { resolveCloneTarget, buildCloneCommand } from '@server/repo-clone';

describe('resolveCloneTarget', () => {
  it('parses a github https URL', () => {
    expect(resolveCloneTarget('https://github.com/owner/repo')).toEqual({
      provider: 'github',
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('strips a trailing .git suffix', () => {
    expect(resolveCloneTarget('https://github.com/owner/repo.git')).toEqual({
      provider: 'github',
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('ignores a trailing # fragment', () => {
    expect(resolveCloneTarget('https://github.com/devbdavis/workshop#')).toEqual({
      provider: 'github',
      host: 'github.com',
      owner: 'devbdavis',
      repo: 'workshop',
    });
  });

  it('ignores trailing slashes', () => {
    expect(resolveCloneTarget('https://github.com/owner/repo/')).toEqual({
      provider: 'github',
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('parses the SSH form', () => {
    expect(resolveCloneTarget('git@github.com:owner/repo.git')).toEqual({
      provider: 'github',
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('treats a self-hosted host as provider "other"', () => {
    expect(resolveCloneTarget('https://git.example.com/team/project')).toEqual({
      provider: 'other',
      host: 'git.example.com',
      owner: 'team',
      repo: 'project',
    });
  });

  it('matches github.com case-insensitively', () => {
    expect(resolveCloneTarget('https://GitHub.com/owner/repo').provider).toBe('github');
  });

  it.each([
    'not a url',
    'https://github.com/owner',
    'https://github.com/',
    'git@github.com:owner',
    '',
    'https://github.com/-bad/repo',
    'https://github.com/owner/..',
    'https://github.com/owner/re po',
  ])('throws on invalid input %j', (input) => {
    expect(() => resolveCloneTarget(input)).toThrow('Invalid repository URL');
  });
});

describe('buildCloneCommand', () => {
  it('uses gh for github targets', () => {
    const target = {
      provider: 'github' as const,
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    };
    expect(buildCloneCommand(target, '/dest/repo')).toEqual({
      cmd: 'gh',
      args: ['repo', 'clone', 'owner/repo', '/dest/repo'],
    });
  });

  it('uses tea for other targets', () => {
    const target = {
      provider: 'other' as const,
      host: 'git.example.com',
      owner: 'team',
      repo: 'project',
    };
    expect(buildCloneCommand(target, '/dest/project')).toEqual({
      cmd: 'tea',
      args: ['clone', 'git.example.com/team/project', '/dest/project'],
    });
  });
});
