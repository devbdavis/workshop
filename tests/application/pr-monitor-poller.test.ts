import { beforeEach, describe, expect, it } from 'vitest';
import { createPrMonitorPoller } from '@application/pr-monitor/poller';
import type { GhAdapter } from '@infrastructure/github/gh-adapter';
import type {
  PrMonitorRepository,
  PrMonitorRegistration,
  PrMonitorPollUpdate,
} from '@domain/pr-monitor/repository';
import type { PrMonitor, PrCheckSummary, PrComment, TodoId, TrackId } from '@foundation/types';

function makeMonitor(overrides: Partial<PrMonitor>): PrMonitor {
  return {
    prUrl: 'https://github.com/acme/widgets/pull/1',
    todoId: 'todo-1' as TodoId,
    trackId: 'track-1' as TrackId,
    repoOwner: 'acme',
    repoName: 'widgets',
    prNumber: 1,
    state: 'open',
    checkStatus: 'pending',
    failingChecks: [],
    unresolvedComments: [],
    monitoring: true,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

function makeFakeRepo(initial: PrMonitor[]): PrMonitorRepository & { all: () => PrMonitor[] } {
  const store = new Map<string, PrMonitor>();
  for (const m of initial) store.set(m.prUrl, m);

  return {
    findByUrl: (url) => store.get(url) ?? null,
    findByTodo: (todoId) => Array.from(store.values()).filter((m) => m.todoId === todoId),
    findByTrack: (trackId) => Array.from(store.values()).filter((m) => m.trackId === trackId),
    findDueForPolling: (limit, olderThanIso) => {
      const cutoff = new Date(olderThanIso).getTime();
      return Array.from(store.values())
        .filter((m) => m.monitoring && (!m.lastPolledAt || new Date(m.lastPolledAt).getTime() <= cutoff))
        .sort((a, b) => {
          if (!a.lastPolledAt && b.lastPolledAt) return -1;
          if (a.lastPolledAt && !b.lastPolledAt) return 1;
          if (!a.lastPolledAt && !b.lastPolledAt) return 0;
          return new Date(a.lastPolledAt!).getTime() - new Date(b.lastPolledAt!).getTime();
        })
        .slice(0, limit);
    },
    register: (reg: PrMonitorRegistration) => {
      const existing = store.get(reg.prUrl);
      const now = new Date().toISOString();
      const next: PrMonitor = existing
        ? { ...existing, ...reg, monitoring: true, updatedAt: now }
        : makeMonitor({
            prUrl: reg.prUrl,
            todoId: reg.todoId,
            trackId: reg.trackId,
            repoOwner: reg.repoOwner,
            repoName: reg.repoName,
            prNumber: reg.prNumber,
            prTitle: reg.prTitle,
            createdAt: now,
            updatedAt: now,
          });
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
    applyPoll: (url, update: PrMonitorPollUpdate) => {
      const m = store.get(url);
      if (!m) return null;
      const now = new Date().toISOString();
      const next: PrMonitor = {
        ...m,
        state: update.state,
        checkStatus: update.checkStatus,
        failingChecks: update.failingChecks,
        unresolvedComments: update.unresolvedComments,
        prTitle: update.prTitle ?? m.prTitle,
        prBranch: update.prBranch ?? m.prBranch,
        lastPolledAt: now,
        lastEventAt: update.changed ? now : m.lastEventAt,
        monitoring: update.stopMonitoring ? false : m.monitoring,
        updatedAt: now,
      };
      store.set(url, next);
      return next;
    },
    all: () => Array.from(store.values()),
  };
}

interface CapturedEvent {
  type: string;
  trackId: string;
  payload?: Record<string, unknown>;
}

function makeGh(handler: (url: string) => Awaited<ReturnType<GhAdapter['fetchPrSnapshot']>>): GhAdapter {
  return { fetchPrSnapshot: async (url) => handler(url) };
}

describe('createPrMonitorPoller', () => {
  let events: CapturedEvent[] = [];

  beforeEach(() => {
    events = [];
  });

  function record(type: 'pr:updated', trackId: string, payload?: Record<string, unknown>) {
    events.push({ type, trackId, payload });
  }

  it('caps refreshes at maxPerCycle per tick', async () => {
    const monitors = Array.from({ length: 8 }, (_, i) =>
      makeMonitor({
        prUrl: `https://github.com/acme/widgets/pull/${i + 1}`,
        prNumber: i + 1,
        lastPolledAt: undefined,
      }),
    );
    const repo = makeFakeRepo(monitors);
    let callCount = 0;
    const gh = makeGh(() => {
      callCount++;
      return {
        state: 'open',
        checkStatus: 'passing',
        failingChecks: [] as PrCheckSummary[],
        unresolvedComments: [] as PrComment[],
        prTitle: 'pr',
        isDraft: false,
        finished: false,
      };
    });

    const poller = createPrMonitorPoller({
      monitors: repo,
      gh,
      broadcast: record,
      intervalMs: 60_000,
      maxPerCycle: 3,
      minPrCooldownMs: 60_000,
      perCallStaggerMs: 0,
    });

    await poller.pollNow();
    expect(callCount).toBe(3);
  });

  it('skips PRs polled inside the cooldown window', async () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    const monitors = [
      makeMonitor({ prUrl: 'https://github.com/x/y/pull/1', lastPolledAt: recent }),
      makeMonitor({ prUrl: 'https://github.com/x/y/pull/2', prNumber: 2, lastPolledAt: undefined }),
    ];
    const repo = makeFakeRepo(monitors);
    let calledFor: string[] = [];
    const gh = makeGh((url) => {
      calledFor.push(url);
      return {
        state: 'open',
        checkStatus: 'passing',
        failingChecks: [],
        unresolvedComments: [],
        prTitle: 'pr',
        isDraft: false,
        finished: false,
      };
    });

    const poller = createPrMonitorPoller({
      monitors: repo,
      gh,
      broadcast: record,
      intervalMs: 120_000,
      maxPerCycle: 5,
      minPrCooldownMs: 120_000,
      perCallStaggerMs: 0,
    });

    await poller.pollNow();
    expect(calledFor).toEqual(['https://github.com/x/y/pull/2']);
  });

  it('broadcasts pr:updated only when something changed', async () => {
    const repo = makeFakeRepo([
      makeMonitor({
        prUrl: 'https://github.com/x/y/pull/1',
        state: 'open',
        checkStatus: 'passing',
      }),
    ]);
    const gh = makeGh(() => ({
      state: 'open',
      checkStatus: 'passing',
      failingChecks: [],
      unresolvedComments: [],
      prTitle: undefined,
      isDraft: false,
      finished: false,
    }));

    const poller = createPrMonitorPoller({
      monitors: repo,
      gh,
      broadcast: record,
      intervalMs: 60_000,
      maxPerCycle: 5,
      minPrCooldownMs: 0,
      perCallStaggerMs: 0,
    });

    await poller.pollNow();
    expect(events).toEqual([]);
  });

  it('broadcasts pr:updated when CI flips to failing', async () => {
    const repo = makeFakeRepo([
      makeMonitor({
        prUrl: 'https://github.com/x/y/pull/1',
        state: 'open',
        checkStatus: 'passing',
      }),
    ]);
    const gh = makeGh(() => ({
      state: 'open',
      checkStatus: 'failing',
      failingChecks: [{ name: 'tests', conclusion: 'FAILURE' }],
      unresolvedComments: [],
      prTitle: undefined,
      isDraft: false,
      finished: false,
    }));

    const poller = createPrMonitorPoller({
      monitors: repo,
      gh,
      broadcast: record,
      intervalMs: 60_000,
      maxPerCycle: 5,
      minPrCooldownMs: 0,
      perCallStaggerMs: 0,
    });

    await poller.pollNow();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('pr:updated');
    expect(events[0].payload).toMatchObject({ checkStatus: 'failing' });
  });

  it('stops monitoring once a PR is merged', async () => {
    const repo = makeFakeRepo([
      makeMonitor({
        prUrl: 'https://github.com/x/y/pull/1',
        state: 'open',
        checkStatus: 'pending',
      }),
    ]);
    const gh = makeGh(() => ({
      state: 'merged',
      checkStatus: 'none',
      failingChecks: [],
      unresolvedComments: [],
      prTitle: undefined,
      isDraft: false,
      finished: true,
    }));

    const poller = createPrMonitorPoller({
      monitors: repo,
      gh,
      broadcast: record,
      intervalMs: 60_000,
      maxPerCycle: 5,
      minPrCooldownMs: 0,
      perCallStaggerMs: 0,
    });

    const updated = await poller.pollNow();
    expect(updated[0].monitoring).toBe(false);
    // A second pollNow should now skip the merged PR.
    const updatedAgain = await poller.pollNow();
    expect(updatedAgain).toEqual([]);
  });

  it('isolates failures so one bad PR does not poison the rest', async () => {
    const repo = makeFakeRepo([
      makeMonitor({ prUrl: 'https://github.com/x/y/pull/1' }),
      makeMonitor({ prUrl: 'https://github.com/x/y/pull/2', prNumber: 2 }),
    ]);
    const gh = makeGh((url) => {
      if (url.endsWith('/1')) {
        throw new Error('gh exploded');
      }
      return {
        state: 'open',
        checkStatus: 'passing',
        failingChecks: [],
        unresolvedComments: [],
        prTitle: undefined,
        isDraft: false,
        finished: false,
      };
    });

    const poller = createPrMonitorPoller({
      monitors: repo,
      gh,
      broadcast: record,
      intervalMs: 60_000,
      maxPerCycle: 5,
      minPrCooldownMs: 0,
      perCallStaggerMs: 0,
    });

    const updated = await poller.pollNow();
    // Only the successful PR is appended to the returned `updated` list; the
    // failing one still has its `last_polled_at` bumped (verify directly) so
    // it rotates to the back of the queue.
    expect(updated.map((m) => m.prUrl)).toEqual(['https://github.com/x/y/pull/2']);
    expect(events).toHaveLength(1);
    const failedRow = repo.findByUrl('https://github.com/x/y/pull/1')!;
    expect(failedRow.lastPolledAt).toBeDefined();
  });
});
