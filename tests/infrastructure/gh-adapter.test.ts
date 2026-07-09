import { describe, expect, it } from 'vitest';
import { createGhAdapter, parseInlineComments, snapshotFromGhJson } from '@infrastructure/github/gh-adapter';
import type { PrComment } from '@foundation/types';

/** Build an inline review comment as it arrives from `parseInlineComments`. */
const inline = (over: Partial<PrComment> = {}): PrComment => ({
  id: 'rc1',
  author: 'reviewer',
  body: 'rename foo',
  createdAt: '2026-05-01',
  kind: 'review',
  path: 'src/foo.ts',
  line: 12,
  ...over,
});

/** Wrap thread nodes in the `gh api graphql` reviewThreads response envelope. */
const reviewThreadsResp = (nodes: unknown[]) => ({
  data: { repository: { pullRequest: { reviewThreads: { nodes } } } },
});

describe('snapshotFromGhJson', () => {
  it('flags merged PRs as finished and clears working state', () => {
    const snap = snapshotFromGhJson(
      {
        state: 'MERGED',
        mergedAt: '2026-05-01T00:00:00Z',
        isDraft: false,
        title: 'Add widgets',
        headRefName: 'add-widgets',
        statusCheckRollup: [
          { name: 'ci', status: 'COMPLETED', conclusion: 'FAILURE', description: 'broken' },
        ],
        reviews: [{ id: 'r1', author: { login: 'rev' }, state: 'CHANGES_REQUESTED', body: 'fix' }],
      },
      [inline()],
    );
    expect(snap.state).toBe('merged');
    expect(snap.finished).toBe(true);
    expect(snap.checkStatus).toBe('none');
    expect(snap.failingChecks).toHaveLength(0);
    expect(snap.unresolvedComments).toHaveLength(0);
  });

  it('reports failing checks with names and details', () => {
    const snap = snapshotFromGhJson({
      state: 'OPEN',
      title: 'Tweak parser',
      headRefName: 'tweak',
      statusCheckRollup: [
        { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
        {
          name: 'tests',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
          detailsUrl: 'https://example.com/tests',
          description: 'expected 1, got 2',
        },
        { name: 'pending', status: 'IN_PROGRESS' },
      ],
    });
    expect(snap.state).toBe('open');
    expect(snap.checkStatus).toBe('failing');
    expect(snap.failingChecks).toEqual([
      expect.objectContaining({
        name: 'tests',
        conclusion: 'FAILURE',
        detailsUrl: 'https://example.com/tests',
        summary: 'expected 1, got 2',
      }),
    ]);
  });

  it('treats only-pending rollups as pending', () => {
    const snap = snapshotFromGhJson({
      state: 'OPEN',
      statusCheckRollup: [
        { name: 'ci', status: 'QUEUED' },
        { name: 'sec', status: 'IN_PROGRESS' },
      ],
    });
    expect(snap.checkStatus).toBe('pending');
    expect(snap.failingChecks).toEqual([]);
  });

  it('marks PR as draft when isDraft=true', () => {
    const snap = snapshotFromGhJson({ state: 'OPEN', isDraft: true });
    expect(snap.state).toBe('draft');
    expect(snap.finished).toBe(false);
  });

  it('surfaces only CHANGES_REQUESTED summaries + inline comments, dropping other reviews', () => {
    const snap = snapshotFromGhJson(
      {
        state: 'OPEN',
        reviews: [
          { id: 'r1', author: { login: 'reviewer' }, state: 'CHANGES_REQUESTED', body: 'please address inline' },
          { id: 'r2', author: { login: 'other' }, state: 'COMMENTED', body: 'just a thought' },
          { id: 'r3', author: { login: 'rev3' }, state: 'APPROVED', body: 'lgtm' },
        ],
      },
      [inline({ id: 'rc1', path: 'src/foo.ts', line: 12 })],
    );
    expect(snap.unresolvedComments.map((c) => c.id)).toEqual(['r1', 'rc1']);
    const summary = snap.unresolvedComments.find((c) => c.id === 'r1')!;
    expect(summary.kind).toBe('review');
    expect(summary.path).toBeUndefined();
    const il = snap.unresolvedComments.find((c) => c.id === 'rc1')!;
    expect(il.path).toBe('src/foo.ts');
    expect(il.line).toBe(12);
  });

  it('filters comments whose author login matches an ignored substring (case-insensitive)', () => {
    const snap = snapshotFromGhJson(
      {
        state: 'OPEN',
        reviews: [
          { id: 'r1', author: { login: 'wiz-inc-abc123' }, state: 'CHANGES_REQUESTED', body: 'scan' },
          { id: 'r2', author: { login: 'A-Human' }, state: 'CHANGES_REQUESTED', body: 'please fix' },
        ],
      },
      [inline({ id: 'rc1', author: 'Klaviyo-Code-Delivery' }), inline({ id: 'rc2', author: 'cursor' })],
      ['trunk-io', 'klaviyo-code-delivery', 'wiz-inc'],
    );
    // Ignored bots (wiz-inc review, klaviyo inline) dropped; human review + unlisted bot (cursor) kept.
    expect(snap.unresolvedComments.map((c) => c.id).sort()).toEqual(['r2', 'rc2']);
  });

  it('keeps comments when the ignore list is empty (default)', () => {
    const snap = snapshotFromGhJson({ state: 'OPEN' }, [inline({ id: 'rc1', author: 'trunk-io' })]);
    expect(snap.unresolvedComments.map((c) => c.id)).toEqual(['rc1']);
  });

  it('skips empty review bodies and non-changes-requested reviews', () => {
    const snap = snapshotFromGhJson({
      state: 'OPEN',
      reviews: [
        { id: 'r1', author: { login: 'rev' }, state: 'APPROVED', body: 'lgtm' },
        { id: 'r2', author: { login: 'rev' }, state: 'COMMENTED', body: 'nit' },
        { id: 'r3', author: { login: 'rev' }, state: 'CHANGES_REQUESTED', body: '' },
      ],
    });
    expect(snap.unresolvedComments).toEqual([]);
  });
});

describe('parseInlineComments', () => {
  it('returns the root comment of each unresolved thread, dropping resolved ones', () => {
    const out = parseInlineComments(
      reviewThreadsResp([
        {
          isResolved: false,
          comments: {
            nodes: [
              { id: 'rc1', author: { login: 'reviewer' }, body: 'rename foo', path: 'src/foo.ts', line: 12, url: 'u1', createdAt: '2026-05-01' },
            ],
          },
        },
        {
          isResolved: true,
          comments: { nodes: [{ id: 'rc2', author: { login: 'reviewer' }, body: 'old', path: 'src/bar.ts', line: 99 }] },
        },
      ]),
    );
    expect(out.map((c) => c.id)).toEqual(['rc1']);
    expect(out[0]).toMatchObject({ kind: 'review', path: 'src/foo.ts', line: 12, author: 'reviewer', url: 'u1' });
  });

  it('falls back to originalLine when line is null (outdated comment)', () => {
    const out = parseInlineComments(
      reviewThreadsResp([
        { isResolved: false, comments: { nodes: [{ id: 'rc1', author: { login: 'r' }, body: 'x', path: 'p', line: null, originalLine: 7 }] } },
      ]),
    );
    expect(out[0].line).toBe(7);
  });

  it('strips HTML noise (Bugbot markup) but keeps the real text and markdown autolinks', () => {
    const body = [
      '<!-- BUGBOT_REVIEW -->',
      'Bugbot found 1 potential issue.',
      '<a href="https://cursor.com/open?link=eyJ2ZXJ"><picture><img alt="Fix" src="x.png"></picture></a>',
      'See <https://example.com>',
    ].join('\n');
    const out = parseInlineComments(
      reviewThreadsResp([
        { isResolved: false, comments: { nodes: [{ id: 'rc1', author: { login: 'cursor' }, body, path: 'p', line: 1 }] } },
      ]),
    );
    const rendered = out[0].body;
    expect(rendered).not.toContain('<!--');
    expect(rendered).not.toContain('<a ');
    expect(rendered).toContain('Bugbot found 1 potential issue.');
    expect(rendered).toContain('<https://example.com>');
  });

  it('tolerates empty or malformed responses', () => {
    expect(parseInlineComments({})).toEqual([]);
    expect(parseInlineComments(reviewThreadsResp([{ isResolved: false, comments: { nodes: [] } }]))).toEqual([]);
  });
});

describe('createGhAdapter', () => {
  function fakeExec(prJson: unknown, threadsJson?: unknown) {
    const calls: string[][] = [];
    const exec = async (_binary: string, args: string[]) => {
      calls.push(args);
      if (args[0] === 'pr') return { stdout: JSON.stringify(prJson), stderr: '' };
      if (args[0] === 'api') return { stdout: JSON.stringify(threadsJson ?? reviewThreadsResp([])), stderr: '' };
      return { stdout: '{}', stderr: '' };
    };
    return { exec, calls };
  }

  it('fetches PR state via `gh pr view` and inline comments via graphql', async () => {
    const { exec, calls } = fakeExec(
      { state: 'OPEN', title: 'hi', headRefName: 'feat' },
      reviewThreadsResp([
        { isResolved: false, comments: { nodes: [{ id: 'rc1', author: { login: 'rev' }, body: 'inline note', path: 'a.ts', line: 3 }] } },
      ]),
    );
    const adapter = createGhAdapter({ ghBinary: 'gh-fake', exec });
    const snap = await adapter.fetchPrSnapshot('https://github.com/acme/widgets/pull/7');
    expect(snap.state).toBe('open');
    expect(snap.prTitle).toBe('hi');
    expect(snap.unresolvedComments.map((c) => c.id)).toEqual(['rc1']);
    expect(calls[0]).toEqual([
      'pr',
      'view',
      'https://github.com/acme/widgets/pull/7',
      '--json',
      expect.stringContaining('statusCheckRollup'),
    ]);
    expect(calls[1][0]).toBe('api');
    expect(calls[1]).toContain('owner=acme');
    expect(calls[1]).toContain('name=widgets');
    expect(calls[1]).toContain('number=7');
  });

  it('skips the graphql inline-comment call for finished PRs', async () => {
    const { exec, calls } = fakeExec({ state: 'MERGED', mergedAt: '2026-05-01T00:00:00Z' });
    const adapter = createGhAdapter({ ghBinary: 'gh-fake', exec });
    const snap = await adapter.fetchPrSnapshot('https://github.com/acme/widgets/pull/7');
    expect(snap.finished).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('pr');
  });

  it('still returns a snapshot when the graphql inline-comment call fails', async () => {
    const exec = async (_binary: string, args: string[]) => {
      if (args[0] === 'pr') return { stdout: JSON.stringify({ state: 'OPEN', title: 'hi' }), stderr: '' };
      throw new Error('graphql boom');
    };
    const adapter = createGhAdapter({ ghBinary: 'gh-fake', exec });
    const snap = await adapter.fetchPrSnapshot('https://github.com/acme/widgets/pull/7');
    expect(snap.state).toBe('open');
    expect(snap.unresolvedComments).toEqual([]);
  });

  it('rejects invalid PR URLs without shelling out', async () => {
    let called = false;
    const adapter = createGhAdapter({
      exec: async () => {
        called = true;
        return { stdout: '', stderr: '' };
      },
    });
    await expect(adapter.fetchPrSnapshot('not a url')).rejects.toThrow(/Invalid PR URL/);
    expect(called).toBe(false);
  });

  it('throws a useful error when gh returns garbage JSON', async () => {
    const adapter = createGhAdapter({
      exec: async () => ({ stdout: 'not-json', stderr: '' }),
    });
    await expect(adapter.fetchPrSnapshot('https://github.com/acme/widgets/pull/1')).rejects.toThrow(/unparseable JSON/);
  });
});
