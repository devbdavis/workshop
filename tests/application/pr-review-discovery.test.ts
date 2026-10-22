import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDatabase, resetDatabase } from '@infrastructure/persistence/database';
import { createPrReviewRepository } from '@infrastructure/persistence/pr-review-repository';
import { createPrReviewDiscoveryPoller } from '@application/pr-review/discovery-poller';
import type { DiscoveredPr } from '@infrastructure/github/gh-review-adapter';

let workDir: string;
let previousDbPath: string | undefined;

beforeAll(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), 'workshop-pr-discovery-test-'));
  previousDbPath = process.env.WORKSHOP_DB_PATH;
  process.env.WORKSHOP_DB_PATH = path.join(workDir, 'workshop.db');
});

afterAll(() => {
  resetDatabase();
  if (previousDbPath !== undefined) process.env.WORKSHOP_DB_PATH = previousDbPath;
  else delete process.env.WORKSHOP_DB_PATH;
  rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDatabase();
  db.exec('DELETE FROM pr_review_findings');
  db.exec('DELETE FROM pr_reviews');
});

function discovered(number: number): DiscoveredPr {
  return {
    url: `https://github.com/acme/widgets/pull/${number}`,
    title: `PR ${number}`,
    author: 'alice',
    repoOwner: 'acme',
    repoName: 'widgets',
    number,
  };
}

describe('PR review discovery poller', () => {
  it('registers newly discovered PRs as incoming and broadcasts', async () => {
    const reviews = createPrReviewRepository();
    const broadcast = vi.fn();
    const poller = createPrReviewDiscoveryPoller({
      reviews,
      forge: {
        discoverReviewRequests: async () => ({ prs: [discovered(1), discovered(2)], hosts: ['github.com'] }),
        fetchPrSnapshot: async () => ({}),
      },
      broadcast,
    });

    expect(await poller.pollNow()).toBe(2);
    const all = reviews.findAll();
    expect(all).toHaveLength(2);
    expect(all.every((r) => r.state === 'incoming' && r.discoveredVia === 'poll')).toBe(true);
    expect(broadcast).toHaveBeenCalledWith('pr-review:updated', 'pr-reviews', { added: 2, pruned: 0, rereview: 0 });
  });

  it('leaves existing rows untouched on re-poll', async () => {
    const reviews = createPrReviewRepository();
    const poller = createPrReviewDiscoveryPoller({
      reviews,
      forge: { discoverReviewRequests: async () => ({ prs: [discovered(1)], hosts: ['github.com'] }), fetchPrSnapshot: async () => ({}) },
      broadcast: vi.fn(),
    });
    await poller.pollNow();
    const row = reviews.findAll()[0];
    reviews.update(row.id, { state: 'ready', draftSummary: 'user work' });

    expect(await poller.pollNow()).toBe(0);
    const after = reviews.findByUrl(row.prUrl);
    expect(after?.state).toBe('ready');
    expect(after?.draftSummary).toBe('user work');
  });

  it('prunes untouched poll-discovered rows that vanished from search, but never manual or in-progress ones', async () => {
    const reviews = createPrReviewRepository();
    const results: DiscoveredPr[][] = [[discovered(1), discovered(2)], []];
    const poller = createPrReviewDiscoveryPoller({
      reviews,
      forge: { discoverReviewRequests: async () => ({ prs: results.shift() ?? [], hosts: ['github.com'] }), fetchPrSnapshot: async () => ({}) },
      broadcast: vi.fn(),
    });
    await poller.pollNow();
    const [first, second] = reviews.findAll().sort((a, b) => a.prNumber - b.prNumber);
    reviews.update(second.id, { state: 'ready' }); // user investment — must survive
    const manual = reviews.upsertIncoming({
      prUrl: 'https://github.com/acme/widgets/pull/99',
      repoOwner: 'acme',
      repoName: 'widgets',
      prNumber: 99,
      discoveredVia: 'manual',
    });

    await poller.pollNow(); // search now returns nothing
    expect(reviews.findById(first.id)).toBeNull(); // pruned
    expect(reviews.findById(second.id)?.state).toBe('ready');
    expect(reviews.findById(manual.id)).not.toBeNull();
  });

  it('never re-adds or prunes a removed PR, even while it still appears in search', async () => {
    const reviews = createPrReviewRepository();
    const poller = createPrReviewDiscoveryPoller({
      reviews,
      forge: { discoverReviewRequests: async () => ({ prs: [discovered(1)], hosts: ['github.com'] }), fetchPrSnapshot: async () => ({}) },
      broadcast: vi.fn(),
    });
    await poller.pollNow();
    const row = reviews.findAll()[0];
    reviews.update(row.id, { state: 'removed' });

    // Still in search results → upsert must leave the removed row alone.
    expect(await poller.pollNow()).toBe(0);
    expect(reviews.findById(row.id)?.state).toBe('removed');
    expect(reviews.findAll()).toHaveLength(1);
  });

  it('swallows discovery failures without touching stored rows', async () => {
    const reviews = createPrReviewRepository();
    reviews.upsertIncoming({
      prUrl: 'https://github.com/acme/widgets/pull/1',
      repoOwner: 'acme',
      repoName: 'widgets',
      prNumber: 1,
      discoveredVia: 'poll',
    });
    const poller = createPrReviewDiscoveryPoller({
      reviews,
      forge: {
        discoverReviewRequests: async () => {
          throw new Error('gh: not logged in');
        },
        fetchPrSnapshot: async () => ({}),
      },
      broadcast: vi.fn(),
    });
    expect(await poller.pollNow()).toBe(0);
    expect(reviews.findAll()).toHaveLength(1);
  });

  // A forge that didn't answer reports zero PRs — that must not read as
  // "every PR on that host went away".
  it('never prunes rows on a host that was not successfully searched', async () => {
    const reviews = createPrReviewRepository();
    reviews.upsertIncoming({
      prUrl: 'https://git.example.com/acme/widgets/pulls/7',
      repoOwner: 'acme',
      repoName: 'widgets',
      prNumber: 7,
      discoveredVia: 'poll',
    });
    const poller = createPrReviewDiscoveryPoller({
      reviews,
      forge: { discoverReviewRequests: async () => ({ prs: [], hosts: ['github.com'] }), fetchPrSnapshot: async () => ({}) },
      broadcast: vi.fn(),
    });
    await poller.pollNow();
    expect(reviews.findAll()).toHaveLength(1);
  });

  it('flips a submitted review to needs_rereview when the author pushes past the analyzed head', async () => {
    const reviews = createPrReviewRepository();
    const submittedReview = reviews.upsertIncoming({
      prUrl: 'https://github.com/acme/widgets/pull/1',
      repoOwner: 'acme',
      repoName: 'widgets',
      prNumber: 1,
      discoveredVia: 'poll',
    });
    reviews.update(submittedReview.id, { state: 'submitted', headSha: 'abc' });
    const fetchPrSnapshot = vi.fn(async () => ({ headRefOid: 'def' }));
    const poller = createPrReviewDiscoveryPoller({
      reviews,
      forge: { discoverReviewRequests: async () => ({ prs: [], hosts: ['github.com'] }), fetchPrSnapshot },
      broadcast: vi.fn(),
    });

    await poller.pollNow();
    expect(reviews.findById(submittedReview.id)?.state).toBe('needs_rereview');
  });

  it('skips the head check for reviews submitted long ago', async () => {
    const reviews = createPrReviewRepository();
    const old = reviews.upsertIncoming({
      prUrl: 'https://github.com/acme/widgets/pull/3',
      repoOwner: 'acme',
      repoName: 'widgets',
      prNumber: 3,
      discoveredVia: 'poll',
    });
    reviews.update(old.id, { state: 'submitted', headSha: 'abc', submittedAt: '2020-01-01T00:00:00.000Z' });
    const fetchPrSnapshot = vi.fn(async () => ({ headRefOid: 'def' }));
    const poller = createPrReviewDiscoveryPoller({
      reviews,
      forge: { discoverReviewRequests: async () => ({ prs: [], hosts: ['github.com'] }), fetchPrSnapshot },
      broadcast: vi.fn(),
    });

    await poller.pollNow();
    expect(fetchPrSnapshot).not.toHaveBeenCalled();
    expect(reviews.findById(old.id)?.state).toBe('submitted');
  });

  it('leaves a submitted review alone when the head SHA is unchanged, and never head-checks other states', async () => {
    const reviews = createPrReviewRepository();
    const submittedReview = reviews.upsertIncoming({
      prUrl: 'https://github.com/acme/widgets/pull/1',
      repoOwner: 'acme',
      repoName: 'widgets',
      prNumber: 1,
      discoveredVia: 'poll',
    });
    reviews.update(submittedReview.id, { state: 'submitted', headSha: 'abc' });
    const readyReview = reviews.upsertIncoming({
      prUrl: 'https://github.com/acme/widgets/pull/2',
      repoOwner: 'acme',
      repoName: 'widgets',
      prNumber: 2,
      discoveredVia: 'poll',
    });
    reviews.update(readyReview.id, { state: 'ready', headSha: 'xyz' });
    const fetchPrSnapshot = vi.fn(async () => ({ headRefOid: 'abc' }));
    const poller = createPrReviewDiscoveryPoller({
      reviews,
      forge: { discoverReviewRequests: async () => ({ prs: [], hosts: ['github.com'] }), fetchPrSnapshot },
      broadcast: vi.fn(),
    });

    await poller.pollNow();
    expect(reviews.findById(submittedReview.id)?.state).toBe('submitted');
    expect(fetchPrSnapshot).toHaveBeenCalledTimes(1);
    expect(fetchPrSnapshot).toHaveBeenCalledWith(submittedReview.prUrl);
  });

  it('registers team requests as team rows, keeps them through a failed team pass, and prunes once a teammate engages', async () => {
    const reviews = createPrReviewRepository();
    const passes: { prs: DiscoveredPr[]; teamPrs?: DiscoveredPr[] }[] = [
      { prs: [discovered(1)], teamPrs: [discovered(1), discovered(2)] }, // #1 asked of you AND your team
      { prs: [discovered(1)], teamPrs: undefined }, // team search failed
      { prs: [discovered(1)], teamPrs: [] }, // a teammate reviewed #2
      { prs: [discovered(1)], teamPrs: [discovered(3)] },
      { prs: [discovered(1), discovered(3)], teamPrs: [] }, // now asked of you directly
    ];
    const poller = createPrReviewDiscoveryPoller({
      reviews,
      forge: {
        discoverReviewRequests: async () => ({ ...passes.shift()!, hosts: ['github.com'] }),
        fetchPrSnapshot: async () => ({}),
      },
      broadcast: vi.fn(),
    });

    expect(await poller.pollNow()).toBe(2);
    const via = () => Object.fromEntries(reviews.findAll().map((r) => [r.prNumber, r.discoveredVia]));
    expect(via()).toEqual({ 1: 'poll', 2: 'team' });
    await poller.pollNow();
    expect(via()).toEqual({ 1: 'poll', 2: 'team' });
    await poller.pollNow();
    expect(via()).toEqual({ 1: 'poll' });
    await poller.pollNow();
    expect(via()).toEqual({ 1: 'poll', 3: 'team' });
    await poller.pollNow();
    expect(via()).toEqual({ 1: 'poll', 3: 'poll' });
  });
});
