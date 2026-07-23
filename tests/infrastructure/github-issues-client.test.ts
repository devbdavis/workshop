import { describe, expect, it } from 'vitest';
import { GithubCliError, getIssueByIdentifier, listAssignedOpenIssues } from '@infrastructure/github/issues-client';

describe('Github issues client', () => {
  it('listAssignedOpenIssues builds externalId as owner/repo#number', async () => {
    const exec = async () => ({
      stdout: JSON.stringify([
        {
          number: 39,
          title: 'Fix thing',
          body: 'details',
          repository: { nameWithOwner: 'bdavis-klaviyo/workshop' },
          url: 'https://github.com/bdavis-klaviyo/workshop/issues/39',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]),
      stderr: '',
    });

    const issues = await listAssignedOpenIssues(undefined, { exec });
    expect(issues).toEqual([
      {
        externalId: 'bdavis-klaviyo/workshop#39',
        title: 'Fix thing',
        description: 'details',
        url: 'https://github.com/bdavis-klaviyo/workshop/issues/39',
        stateName: 'open',
        updatedAt: '2026-01-01T00:00:00Z',
        repository: 'bdavis-klaviyo/workshop',
      },
    ]);
  });

  it('listAssignedOpenIssues passes --owner when given a scope', async () => {
    let capturedArgs: string[] = [];
    const exec = async (_binary: string, args: string[]) => {
      capturedArgs = args;
      return { stdout: '[]', stderr: '' };
    };

    await listAssignedOpenIssues('bdavis-klaviyo', { exec });
    expect(capturedArgs).toContain('--owner');
    expect(capturedArgs).toContain('bdavis-klaviyo');
  });

  it('getIssueByIdentifier returns null for an unparseable identifier without exec-ing', async () => {
    let called = false;
    const exec = async () => {
      called = true;
      return { stdout: '{}', stderr: '' };
    };

    const result = await getIssueByIdentifier('not-an-identifier', { exec });
    expect(result).toBeNull();
    expect(called).toBe(false);
  });

  it('getIssueByIdentifier returns null when gh reports the issue cannot be resolved', async () => {
    const exec = async () => {
      const err = new Error('Command failed') as Error & { code: number; stderr: string };
      err.code = 1;
      err.stderr = "GraphQL: Could not resolve to an issue or pull request with the number of 999. (repository.issue)";
      throw err;
    };

    const result = await getIssueByIdentifier('owner/repo#999', { exec });
    expect(result).toBeNull();
  });

  it('getIssueByIdentifier throws GithubCliError with an auth hint when gh is not authenticated', async () => {
    const exec = async () => {
      const err = new Error('Command failed') as Error & { code: number; stderr: string };
      err.code = 4;
      err.stderr = 'To get started with GitHub CLI, please run:  gh auth login';
      throw err;
    };

    await expect(getIssueByIdentifier('owner/repo#1', { exec })).rejects.toBeInstanceOf(GithubCliError);
    const err = await getIssueByIdentifier('owner/repo#1', { exec }).catch((e: unknown) => e as GithubCliError);
    expect(err.message).toContain('gh auth login');
  });
});
