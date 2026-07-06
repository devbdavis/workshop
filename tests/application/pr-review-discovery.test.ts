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
      gh: { searchReviewRequestedPrs: async () => [discovered(1), discovered(2)] },
      broadcast,
    });

    expect(await poller.pollNow()).toBe(2);
    const all = reviews.findAll();
    expect(all).toHaveLength(2);
    expect(all.every((r) => r.state === 'incoming' && r.discoveredVia === 'poll')).toBe(true);
    expect(broadcast).toHaveBeenCalledWith('pr-review:updated', 'pr-reviews', { added: 2, pruned: 0 });
  });

  it('leaves existing rows untouched on re-poll', async () => {
    const reviews = createPrReviewRepository();
    const poller = createPrReviewDiscoveryPoller({
      reviews,
      gh: { searchReviewRequestedPrs: async () => [discovered(1)] },
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
      gh: { searchReviewRequestedPrs: async () => results.shift() ?? [] },
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

  it('swallows gh failures without touching stored rows', async () => {
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
      gh: {
        searchReviewRequestedPrs: async () => {
          throw new Error('gh: not logged in');
        },
      },
      broadcast: vi.fn(),
    });
    expect(await poller.pollNow()).toBe(0);
    expect(reviews.findAll()).toHaveLength(1);
  });
});
