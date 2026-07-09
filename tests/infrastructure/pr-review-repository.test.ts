import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDatabase, resetDatabase } from '@infrastructure/persistence/database';
import { createPrReviewRepository } from '@infrastructure/persistence/pr-review-repository';
import type { PrReviewRegistration } from '@domain/pr-review/repository';

let workDir: string;
let previousDbPath: string | undefined;

beforeAll(() => {
  workDir = mkdtempSync(path.join(os.tmpdir(), 'workshop-pr-review-test-'));
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

function registration(overrides: Partial<PrReviewRegistration> = {}): PrReviewRegistration {
  return {
    prUrl: 'https://github.com/acme/widgets/pull/7',
    repoOwner: 'acme',
    repoName: 'widgets',
    prNumber: 7,
    prTitle: 'feat: widget polish',
    prAuthor: 'alice',
    discoveredVia: 'poll',
    ...overrides,
  };
}

describe('PrReviewRepository', () => {
  it('registers a review and reads it back', () => {
    const repo = createPrReviewRepository();
    const review = repo.upsertIncoming(registration());
    expect(review.state).toBe('incoming');
    expect(review.prNumber).toBe(7);
    expect(repo.findByUrl(review.prUrl)?.id).toBe(review.id);
    expect(repo.findAll()).toHaveLength(1);
  });

  it('upsert is idempotent by URL and never clobbers user state', () => {
    const repo = createPrReviewRepository();
    const first = repo.upsertIncoming(registration());
    repo.update(first.id, { state: 'ready', draftSummary: 'looks solid' });

    const second = repo.upsertIncoming(registration({ prTitle: 'different title', discoveredVia: 'manual' }));
    expect(second.id).toBe(first.id);
    expect(second.state).toBe('ready');
    expect(second.draftSummary).toBe('looks solid');
    expect(repo.findAll()).toHaveLength(1);
  });

  it('applies partial patches without touching omitted fields', () => {
    const repo = createPrReviewRepository();
    const review = repo.upsertIncoming(registration());
    repo.update(review.id, { state: 'analyzing' });
    const patched = repo.update(review.id, { headSha: 'abc123', suggestedVerdict: 'approve' });
    expect(patched?.state).toBe('analyzing');
    expect(patched?.headSha).toBe('abc123');
    expect(patched?.suggestedVerdict).toBe('approve');
  });

  it('replaces findings atomically and cascades delete', () => {
    const repo = createPrReviewRepository();
    const review = repo.upsertIncoming(registration());

    repo.replaceFindings(review.id, [
      { file: 'src/a.ts', line: 10, summary: 'old', suggestedComment: 'old', anchored: true },
    ]);
    const findings = repo.replaceFindings(review.id, [
      { file: 'src/b.ts', line: 5, summary: 'new one', suggestedComment: 'fix b', anchored: true },
      { file: 'src/c.ts', summary: 'unanchored', suggestedComment: 'fix c', anchored: false },
    ]);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.file)).toEqual(['src/b.ts', 'src/c.ts']);

    repo.delete(review.id);
    const db = getDatabase();
    const orphans = db.prepare('SELECT COUNT(*) AS n FROM pr_review_findings').get() as { n: number };
    expect(orphans.n).toBe(0);
  });

  it('dismisses and reopens a finding, and marks open findings posted', () => {
    const repo = createPrReviewRepository();
    const review = repo.upsertIncoming(registration());
    const [keep, meh] = repo.replaceFindings(review.id, [
      { file: 'src/a.ts', line: 1, summary: 'keep', suggestedComment: 'keep', anchored: true },
      { file: 'src/a.ts', line: 2, summary: 'meh', suggestedComment: 'meh', anchored: true },
    ]);

    expect(repo.updateFinding(meh.id, { status: 'dismissed' })?.status).toBe('dismissed');
    expect(repo.updateFinding(meh.id, { status: 'open' })?.status).toBe('open');
    repo.updateFinding(meh.id, { status: 'dismissed' });

    repo.markOpenFindingsPosted(review.id);
    const after = repo.findingsByReview(review.id);
    expect(after.find((f) => f.id === keep.id)?.status).toBe('posted');
    expect(after.find((f) => f.id === meh.id)?.status).toBe('dismissed');

    const counts = repo.countFindings().get(review.id);
    expect(counts).toEqual({ open: 0, total: 2 });
  });
});
