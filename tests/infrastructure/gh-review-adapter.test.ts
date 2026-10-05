import { describe, expect, it } from 'vitest';
import { createGhReviewAdapter, tailFailedLog } from '@infrastructure/github/gh-review-adapter';

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
      exec: async () => ({ stdout: '[]', stderr: '' }),
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
      exec: async () => ({ stdout: '[]', stderr: '' }),
      execWithStdin: async () => {
        throw new Error('HTTP 422: Unprocessable Entity');
      },
    });
    await expect(
      adapter.submitPrReview('https://github.com/acme/widgets/pull/9', { body: 'x', verdict: 'comment', comments: [] }),
    ).rejects.toThrow('422');
  });

  it('folds a hand-started pending review into the submitted one', async () => {
    const calls: string[][] = [];
    let capturedStdin = '';
    const adapter = createGhReviewAdapter({
      exec: async (_binary, args) => {
        calls.push(args);
        if (args[1].endsWith('/reviews?per_page=100')) {
          return { stdout: JSON.stringify([{ id: 77, state: 'PENDING', body: 'started by hand' }]), stderr: '' };
        }
        if (args[1].includes('/reviews/77/comments')) {
          return {
            stdout: JSON.stringify([
              { path: 'a.py', body: 'needs a runbook', position: 16, line: null, side: null },
              { path: 'b.py', body: 'multi-line', line: 9, side: 'RIGHT', start_line: 7 },
            ]),
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      },
      execWithStdin: async (_binary, _args, stdin) => {
        capturedStdin = stdin;
        return { stdout: '{}', stderr: '' };
      },
    });

    await adapter.submitPrReview('https://github.com/acme/widgets/pull/9', {
      body: 'from workshop',
      verdict: 'comment',
      comments: [{ path: 'src/a.ts', line: 12, side: 'RIGHT', body: 'off-by-one' }],
    });

    // The pending review is consumed, not left to 422 the POST.
    expect(calls).toContainEqual(['api', 'repos/acme/widgets/pulls/9/reviews/77', '--method', 'DELETE']);
    const payload = JSON.parse(capturedStdin) as Record<string, unknown>;
    expect(payload.body).toBe('started by hand\n\nfrom workshop');
    expect(payload.comments).toEqual([
      { path: 'a.py', body: 'needs a runbook', position: 16 },
      { path: 'b.py', body: 'multi-line', line: 9, side: 'RIGHT', start_line: 7, start_side: 'RIGHT' },
      { path: 'src/a.ts', line: 12, side: 'RIGHT', body: 'off-by-one' },
    ]);
  });

  it('restores the pending review when the merged submit fails', async () => {
    const stdins: string[] = [];
    const adapter = createGhReviewAdapter({
      exec: async (_binary, args) => {
        if (args[1].endsWith('/reviews?per_page=100')) {
          return { stdout: JSON.stringify([{ id: 77, state: 'PENDING', body: '' }]), stderr: '' };
        }
        if (args[1].includes('/comments')) {
          return { stdout: JSON.stringify([{ path: 'a.py', body: 'keep me', position: 16 }]), stderr: '' };
        }
        return { stdout: '', stderr: '' };
      },
      execWithStdin: async (_binary, _args, stdin) => {
        stdins.push(stdin);
        if (stdins.length === 1) throw new Error('HTTP 422: Unprocessable Entity');
        return { stdout: '{}', stderr: '' };
      },
    });

    await expect(
      adapter.submitPrReview('https://github.com/acme/widgets/pull/9', { body: 'x', verdict: 'comment', comments: [] }),
    ).rejects.toThrow('422');
    // Second call re-creates a pending review holding the hand-written comment.
    const restored = JSON.parse(stdins[1]) as Record<string, unknown>;
    expect(restored.event).toBeUndefined();
    expect(restored.comments).toEqual([{ path: 'a.py', body: 'keep me', position: 16 }]);
  });
});

describe('fetchCheckLog', () => {
  it('fetches the failed-step log for the job in the details URL, tailed and de-prefixed', async () => {
    let capturedArgs: string[] = [];
    const adapter = createGhReviewAdapter({
      exec: async (_binary, args) => {
        capturedArgs = args;
        return { stdout: 'build\tRun tests\t2026-10-04T22:01:49.8996270Z FAIL x.test.ts\tdetail\n', stderr: '' };
      },
    });
    const log = await adapter.fetchCheckLog(
      'https://github.com/acme/widgets/pull/9',
      'https://github.com/acme/widgets/actions/runs/111/job/222',
    );
    expect(capturedArgs).toEqual(['run', 'view', '--job', '222', '--log-failed', '-R', 'acme/widgets']);
    expect(log).toBe('FAIL x.test.ts\tdetail');
  });

  it('rejects checks that are not Actions jobs without shelling out', async () => {
    const adapter = createGhReviewAdapter({ exec: async () => { throw new Error('should not run'); } });
    await expect(
      adapter.fetchCheckLog('https://github.com/acme/widgets/pull/9', 'https://ci.example.com/build/1'),
    ).rejects.toThrow('Not a GitHub Actions job');
  });

  it('keeps only the last N lines', () => {
    const raw = Array.from({ length: 5 }, (_, i) => `j\ts\tline${i}`).join('\n');
    expect(tailFailedLog(raw, 2)).toBe('line3\nline4');
  });
});
