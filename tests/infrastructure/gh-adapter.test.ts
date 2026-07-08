import { describe, expect, it } from 'vitest';
import {
  createGhAdapter,
  parsePrUrl,
  snapshotFromGhJson,
} from '@infrastructure/github/gh-adapter';

describe('parsePrUrl', () => {
  it('parses canonical PR URLs', () => {
    expect(parsePrUrl('https://github.com/acme/widgets/pull/42')).toEqual({
      owner: 'acme',
      repo: 'widgets',
      number: 42,
    });
  });

  it('tolerates trailing path segments', () => {
    expect(parsePrUrl('https://github.com/acme/widgets/pull/42/files')).toEqual({
      owner: 'acme',
      repo: 'widgets',
      number: 42,
    });
  });

  it('rejects non-PR URLs', () => {
    expect(parsePrUrl('https://github.com/acme/widgets/issues/42')).toBeNull();
    expect(parsePrUrl('https://example.com/acme/widgets/pull/42')).toBeNull();
    expect(parsePrUrl('not-a-url')).toBeNull();
    expect(parsePrUrl('https://github.com/acme')).toBeNull();
  });
});

describe('snapshotFromGhJson', () => {
  it('flags merged PRs as finished and clears working state', () => {
    const snap = snapshotFromGhJson({
      state: 'MERGED',
      mergedAt: '2026-05-01T00:00:00Z',
      isDraft: false,
      title: 'Add widgets',
      headRefName: 'add-widgets',
      statusCheckRollup: [
        { name: 'ci', status: 'COMPLETED', conclusion: 'FAILURE', description: 'broken' },
      ],
      comments: [{ id: 'c1', author: { login: 'reviewer' }, body: 'fix this', createdAt: '2026-05-01' }],
    });
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

  it('surfaces issue comments + unresolved review-thread comments and drops resolved ones', () => {
    const snap = snapshotFromGhJson({
      state: 'OPEN',
      comments: [{ id: 'i1', author: { login: 'bot' }, body: 'top-level comment', createdAt: '2026-05-01' }],
      reviews: [
        {
          id: 'r1',
          author: { login: 'reviewer' },
          state: 'CHANGES_REQUESTED',
          body: 'overall: please address inline',
          comments: [
            {
              id: 'rc1',
              author: { login: 'reviewer' },
              body: 'rename foo',
              createdAt: '2026-05-01',
              path: 'src/foo.ts',
              line: 12,
              isResolved: false,
            },
            {
              id: 'rc2',
              author: { login: 'reviewer' },
              body: 'old — resolved',
              createdAt: '2026-05-01',
              path: 'src/bar.ts',
              line: 99,
              isResolved: true,
            },
          ],
        },
      ],
    });
    expect(snap.unresolvedComments.map((c) => c.id)).toEqual(['i1', 'rc1']);
    const review = snap.unresolvedComments.find((c) => c.id === 'rc1')!;
    expect(review.kind).toBe('review');
    expect(review.path).toBe('src/foo.ts');
    expect(review.line).toBe(12);
  });

  it('filters comments whose author login matches an ignored substring (case-insensitive)', () => {
    const snap = snapshotFromGhJson(
      {
        state: 'OPEN',
        comments: [
          { id: 'i1', author: { login: 'trunk-io' }, body: 'merged', createdAt: '2026-05-01' },
          { id: 'i2', author: { login: 'spacelift' }, body: 'coverage', createdAt: '2026-05-01' },
          { id: 'i3', author: { login: 'coderabbitai' }, body: 'suggestion', createdAt: '2026-05-01' },
          { id: 'i4', author: { login: 'a-human' }, body: 'please fix', createdAt: '2026-05-01' },
        ],
        reviews: [
          {
            id: 'r1',
            author: { login: 'wiz-inc-abc123' },
            state: 'CHANGES_REQUESTED',
            comments: [
              { id: 'rc1', author: { login: 'wiz-inc-abc123' }, body: 'scan', createdAt: '2026-05-01', isResolved: false },
              { id: 'rc2', author: { login: 'cursor' }, body: 'bug', createdAt: '2026-05-01', isResolved: false },
            ],
          },
        ],
      },
      ['trunk-io', 'spacelift', 'wiz-inc'],
    );
    // Ignored bots dropped; humans + unlisted bots (coderabbitai, cursor) kept.
    expect(snap.unresolvedComments.map((c) => c.id).sort()).toEqual(['i3', 'i4', 'rc2']);
  });

  it('keeps every comment when the ignore list is empty (default)', () => {
    const snap = snapshotFromGhJson({
      state: 'OPEN',
      comments: [{ id: 'i1', author: { login: 'trunk-io' }, body: 'merged', createdAt: '2026-05-01' }],
    });
    expect(snap.unresolvedComments.map((c) => c.id)).toEqual(['i1']);
  });

  it('skips empty review bodies and approved reviews', () => {
    const snap = snapshotFromGhJson({
      state: 'OPEN',
      reviews: [
        { id: 'r1', author: { login: 'rev' }, state: 'APPROVED', body: 'lgtm' },
        { id: 'r2', author: { login: 'rev' }, state: 'CHANGES_REQUESTED', body: '' },
      ],
    });
    expect(snap.unresolvedComments).toEqual([]);
  });
});

describe('createGhAdapter', () => {
  it('invokes gh with --json fields and parses the result', async () => {
    let receivedArgs: string[] = [];
    const adapter = createGhAdapter({
      ghBinary: 'gh-fake',
      exec: async (binary, args) => {
        expect(binary).toBe('gh-fake');
        receivedArgs = args;
        return {
          stdout: JSON.stringify({ state: 'OPEN', title: 'hi', headRefName: 'feat' }),
          stderr: '',
        };
      },
    });
    const snap = await adapter.fetchPrSnapshot('https://github.com/acme/widgets/pull/7');
    expect(snap.state).toBe('open');
    expect(snap.prTitle).toBe('hi');
    expect(snap.headRefName).toBe('feat');
    expect(receivedArgs).toEqual([
      'pr',
      'view',
      'https://github.com/acme/widgets/pull/7',
      '--json',
      expect.stringContaining('statusCheckRollup'),
    ]);
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
