import { describe, expect, it } from 'vitest';
import { createPrMonitorRegistrar } from '@application/pr-monitor/registrar';
import type {
  PrMonitorRepository,
  PrMonitorRegistration,
  PrMonitorPollUpdate,
} from '@domain/pr-monitor/repository';
import type { PrMonitor, Todo, TodoId, TrackId } from '@foundation/types';

function fakeRepo(): PrMonitorRepository {
  const store = new Map<string, PrMonitor>();
  return {
    findByUrl: (url) => store.get(url) ?? null,
    findByTodo: (todoId) => Array.from(store.values()).filter((m) => m.todoId === todoId),
    findByTrack: (trackId) => Array.from(store.values()).filter((m) => m.trackId === trackId),
    findDueForPolling: () => [],
    register: (reg: PrMonitorRegistration) => {
      const now = new Date().toISOString();
      const existing = store.get(reg.prUrl);
      const next: PrMonitor = existing
        ? { ...existing, ...reg, monitoring: true, updatedAt: now }
        : {
            prUrl: reg.prUrl,
            todoId: reg.todoId,
            trackId: reg.trackId,
            repoOwner: reg.repoOwner,
            repoName: reg.repoName,
            prNumber: reg.prNumber,
            prTitle: reg.prTitle,
            state: 'unknown',
            checkStatus: 'none',
            failingChecks: [],
            unresolvedComments: [],
            monitoring: true,
            createdAt: now,
            updatedAt: now,
          };
      store.set(reg.prUrl, next);
      return next;
    },
    unregister: (url) => store.delete(url),
    pauseMonitoring: (url) => {
      const m = store.get(url);
      if (!m) return null;
      const next = { ...m, monitoring: false };
      store.set(url, next);
      return next;
    },
    applyPoll: (url, _update: PrMonitorPollUpdate) => store.get(url) ?? null,
  };
}

function makeTodo(prs: { url: string; title?: string }[]): Todo {
  return {
    id: 'todo-1' as TodoId,
    trackId: 'track-1' as TrackId,
    title: 't',
    status: 'review',
    priority: 'medium',
    refined: true,
    sortOrder: 0,
    createdAt: '2026-05-01',
    updatedAt: '2026-05-01',
    pullRequests: prs,
  };
}

describe('PR monitor registrar.reconcile', () => {
  it('registers monitors for newly-added PR URLs', () => {
    const monitors = fakeRepo();
    const reg = createPrMonitorRegistrar(monitors);

    const result = reg.reconcile(makeTodo([
      { url: 'https://github.com/acme/widgets/pull/7', title: 'feat: widgets' },
    ]));

    expect(result.added).toEqual(['https://github.com/acme/widgets/pull/7']);
    expect(result.removed).toEqual([]);
    const stored = monitors.findByUrl('https://github.com/acme/widgets/pull/7')!;
    expect(stored.repoOwner).toBe('acme');
    expect(stored.repoName).toBe('widgets');
    expect(stored.prNumber).toBe(7);
    expect(stored.prTitle).toBe('feat: widgets');
  });

  it('skips PR URLs that do not look like GitHub PRs', () => {
    const monitors = fakeRepo();
    const reg = createPrMonitorRegistrar(monitors);

    const result = reg.reconcile(makeTodo([
      { url: 'https://example.com/something' },
      { url: 'https://github.com/acme/widgets/issues/7' },
    ]));

    expect(result.added).toEqual([]);
    expect(monitors.findByTodo('todo-1' as TodoId)).toEqual([]);
  });

  it('removes monitors whose URLs were dropped from the todo', () => {
    const monitors = fakeRepo();
    const reg = createPrMonitorRegistrar(monitors);

    reg.reconcile(makeTodo([
      { url: 'https://github.com/acme/widgets/pull/1' },
      { url: 'https://github.com/acme/widgets/pull/2' },
    ]));
    const result = reg.reconcile(makeTodo([
      { url: 'https://github.com/acme/widgets/pull/2' },
    ]));

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual(['https://github.com/acme/widgets/pull/1']);
    expect(monitors.findByTodo('todo-1' as TodoId).map((m) => m.prUrl)).toEqual([
      'https://github.com/acme/widgets/pull/2',
    ]);
  });

  it('is idempotent — re-reconciling a stable list adds and removes nothing', () => {
    const monitors = fakeRepo();
    const reg = createPrMonitorRegistrar(monitors);

    const todo = makeTodo([{ url: 'https://github.com/acme/widgets/pull/3' }]);
    reg.reconcile(todo);
    const second = reg.reconcile(todo);
    expect(second.added).toEqual([]);
    expect(second.removed).toEqual([]);
  });

  it('removeAllForTodo unregisters every monitor row for the todo', () => {
    const monitors = fakeRepo();
    const reg = createPrMonitorRegistrar(monitors);

    reg.reconcile(makeTodo([
      { url: 'https://github.com/acme/widgets/pull/1' },
      { url: 'https://github.com/acme/widgets/pull/2' },
    ]));
    const removed = reg.removeAllForTodo('todo-1');
    expect(removed).toBe(2);
    expect(monitors.findByTodo('todo-1' as TodoId)).toEqual([]);
  });
});
