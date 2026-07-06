import { describe, expect, it } from 'vitest';
import { interpolatePrTemplate } from '@application/pr-monitor/prompt-interpolation';
import type { PrMonitor, TodoId, TrackId } from '@foundation/types';

function fakeMonitor(overrides: Partial<PrMonitor> = {}): PrMonitor {
  return {
    prUrl: 'https://github.com/acme/widgets/pull/7',
    todoId: 'todo-1' as TodoId,
    trackId: 'track-1' as TrackId,
    repoOwner: 'acme',
    repoName: 'widgets',
    prNumber: 7,
    prTitle: 'feat: widgets',
    prBranch: 'feat-widgets',
    state: 'open',
    checkStatus: 'failing',
    failingChecks: [
      { name: 'tests', conclusion: 'FAILURE', detailsUrl: 'https://example.com/tests', summary: 'AssertionError' },
    ],
    unresolvedComments: [
      { id: 'rc1', author: 'reviewer', body: 'rename foo', createdAt: '2026-05-01', kind: 'review', path: 'src/foo.ts', line: 12 },
      { id: 'rc2', author: 'reviewer', body: 'add docs', createdAt: '2026-05-01', kind: 'review', path: 'README.md', line: 5 },
    ],
    monitoring: true,
    createdAt: '2026-05-01',
    updatedAt: '2026-05-01',
    ...overrides,
  };
}

describe('interpolatePrTemplate', () => {
  it('expands all the standard PR variables', () => {
    const out = interpolatePrTemplate(
      '{{pr.title}} ({{pr.url}}) on branch {{pr.branch}} in {{pr.repo}} (#{{pr.number}})',
      { monitor: fakeMonitor() },
    );
    expect(out).toBe(
      'feat: widgets (https://github.com/acme/widgets/pull/7) on branch feat-widgets in acme/widgets (#7)',
    );
  });

  it('falls back to "PR #N" when prTitle is unset', () => {
    const out = interpolatePrTemplate('{{pr.title}}', { monitor: fakeMonitor({ prTitle: undefined }) });
    expect(out).toBe('PR #7');
  });

  it('formats failing checks as a markdown list', () => {
    const out = interpolatePrTemplate('{{pr.failing_checks}}', { monitor: fakeMonitor() });
    expect(out).toContain('**tests**');
    expect(out).toContain('FAILURE');
    expect(out).toContain('https://example.com/tests');
    expect(out).toContain('> AssertionError');
  });

  it('shows the placeholder list when there are no failing checks', () => {
    const out = interpolatePrTemplate('{{pr.failing_checks}}', {
      monitor: fakeMonitor({ failingChecks: [] }),
    });
    expect(out).toContain('no failing checks');
  });

  it('respects the comments override (single-comment dispatch)', () => {
    const monitor = fakeMonitor();
    const out = interpolatePrTemplate('{{pr.comments}}', {
      monitor,
      comments: [monitor.unresolvedComments[0]],
    });
    expect(out).toContain('rename foo');
    expect(out).not.toContain('add docs');
    expect(out).toContain('src/foo.ts:12');
  });

  it('leaves unknown {{pr.*}} keys in place so typos are visible', () => {
    const out = interpolatePrTemplate('{{pr.bogus}}', { monitor: fakeMonitor() });
    expect(out).toBe('{{pr.bogus}}');
  });
});
