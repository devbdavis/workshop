import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTeaConfig, resetGiteaLoginCache } from '@infrastructure/forge/tea-config';
import { parsePrUrl } from '@infrastructure/forge/pr-url';
import { createGiteaAdapter, type GiteaFetch } from '@infrastructure/forge/gitea-adapter';
import { createForgeAdapter } from '@infrastructure/forge/forge-adapter';

const TEA_YAML = `logins:
    - name: chu
      url: https://git.example.com
      token: deadbeef
      default: true
      ssh_host: git.example.com
preferences:
    editor: false
`;

let workDir: string;
let previousConfig: string | undefined;

beforeEach(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), 'workshop-forge-test-'));
  const configPath = path.join(workDir, 'config.yml');
  writeFileSync(configPath, TEA_YAML);
  previousConfig = process.env.TEA_CONFIG;
  process.env.TEA_CONFIG = configPath;
  resetGiteaLoginCache();
});

afterEach(() => {
  if (previousConfig !== undefined) process.env.TEA_CONFIG = previousConfig;
  else delete process.env.TEA_CONFIG;
  resetGiteaLoginCache();
  rmSync(workDir, { recursive: true, force: true });
});

describe('parseTeaConfig', () => {
  it('extracts host, origin and token per login', () => {
    expect(parseTeaConfig(TEA_YAML)).toEqual([
      { host: 'git.example.com', url: 'https://git.example.com', token: 'deadbeef' },
    ]);
  });

  it('keeps logins separate and skips incomplete ones', () => {
    const yaml = `logins:
    - name: a
      url: https://a.example.com
      token: aaa
    - name: b
      url: https://b.example.com
`;
    expect(parseTeaConfig(yaml).map((l) => l.host)).toEqual(['a.example.com']);
  });

  // A trailing section reusing the key name must not overwrite the last login.
  it('ignores url/token keys outside the logins block', () => {
    const yaml = `logins:
    - name: a
      url: https://a.example.com
      token: aaa
preferences:
    url: https://elsewhere.example.com
    token: nope
`;
    expect(parseTeaConfig(yaml)).toEqual([
      { host: 'a.example.com', url: 'https://a.example.com', token: 'aaa' },
    ]);
  });
});

describe('parsePrUrl', () => {
  it('parses GitHub PR URLs', () => {
    expect(parsePrUrl('https://github.com/acme/widgets/pull/42')).toEqual({
      owner: 'acme',
      repo: 'widgets',
      number: 42,
      host: 'github.com',
      forge: 'github',
    });
  });

  it('tolerates trailing path segments', () => {
    expect(parsePrUrl('https://github.com/acme/widgets/pull/42/files')?.number).toBe(42);
  });

  it('parses PR URLs on a configured Gitea host', () => {
    expect(parsePrUrl('https://git.example.com/acme/widgets/pulls/7')).toEqual({
      owner: 'acme',
      repo: 'widgets',
      number: 7,
      host: 'git.example.com',
      forge: 'gitea',
    });
  });

  it('rejects unknown hosts and non-PR URLs', () => {
    expect(parsePrUrl('https://git.unknown.example/acme/widgets/pulls/7')).toBeNull();
    expect(parsePrUrl('https://github.com/acme/widgets/issues/42')).toBeNull();
    expect(parsePrUrl('not-a-url')).toBeNull();
    expect(parsePrUrl('https://github.com/acme')).toBeNull();
  });
});

function fakeFetch(routes: Record<string, unknown>): GiteaFetch {
  return async (url, init) => {
    const key = `${init.method} ${url.replace('https://git.example.com/api/v1', '')}`;
    if (!(key in routes)) return { ok: false, status: 404, text: async () => 'not found' };
    const value = routes[key];
    return { ok: true, status: 200, text: async () => (typeof value === 'string' ? value : JSON.stringify(value)) };
  };
}

const PR_URL = 'https://git.example.com/acme/widgets/pulls/7';

describe('GiteaAdapter', () => {
  it('maps a live PR into a snapshot, including failing checks and unresolved comments', async () => {
    const adapter = createGiteaAdapter({
      fetchImpl: fakeFetch({
        'GET /repos/acme/widgets/pulls/7': {
          title: 'fix: thing',
          body: 'body text',
          user: { login: 'alice' },
          state: 'open',
          draft: false,
          merged: false,
          head: { ref: 'feat/x', sha: 'abc123' },
        },
        'GET /repos/acme/widgets/commits/abc123/status': {
          state: 'failure',
          statuses: [
            { status: 'success', context: 'build' },
            { status: 'failure', context: 'test', description: 'boom', target_url: '/acme/widgets/actions/runs/1' },
          ],
        },
        'GET /repos/acme/widgets/issues/7/comments': [
          { id: 5, user: { login: 'bob' }, body: 'looks good', created_at: 'T', html_url: 'u' },
        ],
        'GET /repos/acme/widgets/pulls/7/reviews': [{ id: 9, user: { login: 'carol' }, state: 'REQUEST_CHANGES' }],
        'GET /repos/acme/widgets/pulls/7/reviews/9/comments': [
          { id: 11, user: { login: 'carol' }, body: 'off by one', path: 'src/a.ts', position: 12 },
          { id: 12, user: { login: 'carol' }, body: 'already handled', path: 'src/b.ts', resolver: { login: 'alice' } },
        ],
      }),
    });

    const snap = await adapter.fetchPrSnapshot(PR_URL);
    expect(snap.state).toBe('open');
    expect(snap.finished).toBe(false);
    expect(snap.checkStatus).toBe('failing');
    expect(snap.failingChecks).toEqual([
      {
        name: 'test',
        conclusion: 'failure',
        status: 'failure',
        // Gitea returns site-relative URLs for its own Actions.
        detailsUrl: 'https://git.example.com/acme/widgets/actions/runs/1',
        summary: 'boom',
      },
    ]);
    expect(snap.headRefOid).toBe('abc123');
    // Resolved review comments are dropped; the review's empty body isn't surfaced.
    expect(snap.unresolvedComments.map((c) => c.id)).toEqual(['5', 'rc-11']);
    expect(snap.unresolvedComments[1]).toMatchObject({ path: 'src/a.ts', line: 12, kind: 'review' });
  });

  it('does not report a warning-only check run as passing', async () => {
    const adapter = createGiteaAdapter({
      fetchImpl: fakeFetch({
        'GET /repos/acme/widgets/pulls/7': { state: 'open', head: { sha: 'abc123' } },
        'GET /repos/acme/widgets/commits/abc123/status': {
          statuses: [{ status: 'success', context: 'build' }, { status: 'warning', context: 'lint' }],
        },
        'GET /repos/acme/widgets/issues/7/comments': [],
        'GET /repos/acme/widgets/pulls/7/reviews': [],
      }),
    });
    const snap = await adapter.fetchPrSnapshot(PR_URL);
    expect(snap.checkStatus).toBe('error');
    expect(snap.failingChecks.map((c) => c.name)).toEqual(['lint']);
  });

  it('treats merged PRs as finished and skips check/comment fetches', async () => {
    const adapter = createGiteaAdapter({
      fetchImpl: fakeFetch({
        'GET /repos/acme/widgets/pulls/7': { state: 'closed', merged: true, head: { sha: 'abc' } },
      }),
    });
    const snap = await adapter.fetchPrSnapshot(PR_URL);
    expect(snap).toMatchObject({ state: 'merged', finished: true, checkStatus: 'none' });
    expect(snap.unresolvedComments).toEqual([]);
  });

  it('submits a review using Gitea position fields instead of line/side', async () => {
    let captured: unknown;
    const adapter = createGiteaAdapter({
      fetchImpl: async (_url, init) => {
        captured = JSON.parse(init.body!);
        return { ok: true, status: 200, text: async () => '{}' };
      },
    });

    await adapter.submitPrReview(PR_URL, {
      body: 'summary',
      verdict: 'request_changes',
      comments: [
        { path: 'src/a.ts', line: 12, side: 'RIGHT', body: 'new side' },
        { path: 'src/b.ts', line: 3, side: 'LEFT', body: 'old side' },
      ],
    });

    expect(captured).toEqual({
      body: 'summary',
      event: 'REQUEST_CHANGES',
      comments: [
        { path: 'src/a.ts', body: 'new side', new_position: 12 },
        { path: 'src/b.ts', body: 'old side', old_position: 3 },
      ],
    });
  });

  it('surfaces API errors rather than silently succeeding', async () => {
    const adapter = createGiteaAdapter({
      fetchImpl: async () => ({ ok: false, status: 422, text: async () => 'Unprocessable' }),
    });
    await expect(adapter.submitPrReview(PR_URL, { body: 'x', verdict: 'comment', comments: [] })).rejects.toThrow('422');
  });
});

describe('ForgeAdapter', () => {
  const stubGithub = {
    fetchPrSnapshot: vi.fn(async () => ({ state: 'open' }) as never),
    fetchPrDiff: vi.fn(async () => 'gh-diff'),
    submitPrReview: vi.fn(async () => {}),
    searchReviewRequestedPrs: vi.fn(async () => []),
    fetchCheckLog: vi.fn(async () => 'gh-log'),
  };
  const stubGitea = {
    fetchPrSnapshot: vi.fn(async () => ({ state: 'open' }) as never),
    fetchPrDiff: vi.fn(async () => 'tea-diff'),
    submitPrReview: vi.fn(async () => {}),
    discoverReviewRequests: vi.fn(async () => ({ prs: [], hosts: ['git.example.com'] })),
    fetchCheckLog: vi.fn(async () => 'tea-log'),
  };

  beforeEach(() => vi.clearAllMocks());

  it('routes each PR to the forge that hosts it', async () => {
    const forge = createForgeAdapter({ github: stubGithub, gitea: stubGitea });
    expect(await forge.fetchPrDiff('https://github.com/acme/widgets/pull/1')).toBe('gh-diff');
    expect(await forge.fetchPrDiff(PR_URL)).toBe('tea-diff');
    expect(await forge.fetchCheckLog('https://github.com/acme/widgets/pull/1', 'u')).toBe('gh-log');
    expect(await forge.fetchCheckLog(PR_URL, 'u')).toBe('tea-log');
  });

  // A host that didn't answer must be absent from `hosts`, or the discovery
  // poller would read its zero results as "every PR there went away" and prune.
  it('isolates a GitHub discovery failure from Gitea', async () => {
    stubGithub.searchReviewRequestedPrs.mockRejectedValueOnce(new Error('gh not authenticated'));
    const forge = createForgeAdapter({ github: stubGithub, gitea: stubGitea });
    expect((await forge.discoverReviewRequests()).hosts).toEqual(['git.example.com']);
  });

  it('isolates a Gitea discovery failure from GitHub', async () => {
    stubGitea.discoverReviewRequests.mockRejectedValueOnce(new Error('gitea unreachable'));
    const forge = createForgeAdapter({ github: stubGithub, gitea: stubGitea });
    expect((await forge.discoverReviewRequests()).hosts).toEqual(['github.com']);
  });
});
