import { describe, expect, it } from 'vitest';
import { createGhReviewAdapter } from '@infrastructure/github/gh-review-adapter';

describe('GhReviewAdapter', () => {
  it('parses search results into DiscoveredPr and searches explicit review requests only', async () => {
    let capturedArgs: string[] = [];
    const adapter = createGhReviewAdapter({
      exec: async (_binary, args) => {
        capturedArgs = args;
        return {
          stdout: JSON.stringify([
            {
              url: 'https://github.com/acme/widgets/pull/9',
              title: 'fix: thing',
              author: { login: 'alice' },
              repository: { name: 'widgets', nameWithOwner: 'acme/widgets' },
              number: 9,
              body: 'This PR fixes the thing.',
              updatedAt: '2026-07-01T00:00:00Z',
            },
            { title: 'malformed — no url/number' },
          ]),
          stderr: '',
        };
      },
    });

    const prs = await adapter.searchReviewRequestedPrs();
    // Explicit-only qualifier — --review-requested would also match team requests.
    expect(capturedArgs).toContain('user-review-requested:@me');
    expect(capturedArgs).not.toContain('--review-requested=@me');
    expect(prs).toHaveLength(1);
    expect(prs[0]).toEqual({
      url: 'https://github.com/acme/widgets/pull/9',
      title: 'fix: thing',
      author: 'alice',
      repoOwner: 'acme',
      repoName: 'widgets',
      number: 9,
      body: 'This PR fixes the thing.',
      updatedAt: '2026-07-01T00:00:00Z',
    });
  });

  it('submits a review with the GitHub API payload shape on stdin', async () => {
    let capturedArgs: string[] = [];
    let capturedStdin = '';
    const adapter = createGhReviewAdapter({
      execWithStdin: async (_binary, args, stdin) => {
        capturedArgs = args;
        capturedStdin = stdin;
        return { stdout: '{}', stderr: '' };
      },
    });

    await adapter.submitPrReview('https://github.com/acme/widgets/pull/9', {
      body: 'Nice work overall!',
      verdict: 'request_changes',
      comments: [{ path: 'src/a.ts', line: 12, side: 'RIGHT', body: 'off-by-one here' }],
    });

    expect(capturedArgs).toContain('repos/acme/widgets/pulls/9/reviews');
    const payload = JSON.parse(capturedStdin) as Record<string, unknown>;
    expect(payload.event).toBe('REQUEST_CHANGES');
    expect(payload.body).toBe('Nice work overall!');
    expect(payload.comments).toEqual([{ path: 'src/a.ts', line: 12, side: 'RIGHT', body: 'off-by-one here' }]);
  });

  it('propagates gh failures from submit', async () => {
    const adapter = createGhReviewAdapter({
      execWithStdin: async () => {
        throw new Error('HTTP 422: Unprocessable Entity');
      },
    });
    await expect(
      adapter.submitPrReview('https://github.com/acme/widgets/pull/9', { body: 'x', verdict: 'comment', comments: [] }),
    ).rejects.toThrow('422');
  });
});
