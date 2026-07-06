import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type {
  PrReviewRepository,
  PrReviewRegistration,
  PrReviewPatch,
  PrReviewFindingInput,
  PrReviewFindingPatch,
} from '@domain/pr-review/repository';
import type {
  PrReview,
  PrReviewFinding,
  PrReviewFindingId,
  PrReviewFindingStatus,
  PrReviewId,
  PrReviewState,
  PrReviewVerdict,
  PrReviewDiscoveredVia,
  SessionId,
} from '@foundation/types';

interface PrReviewRow {
  id: string;
  pr_url: string;
  repo_owner: string;
  repo_name: string;
  pr_number: number;
  pr_title: string | null;
  pr_author: string | null;
  pr_branch: string | null;
  pr_body: string | null;
  head_sha: string | null;
  state: string;
  discovered_via: string;
  session_id: string | null;
  draft_summary: string | null;
  suggested_verdict: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PrReviewFindingRow {
  id: string;
  review_id: string;
  file: string;
  line: number | null;
  side: string;
  category: string | null;
  summary: string;
  failure_scenario: string | null;
  suggested_comment: string;
  code_context: string | null;
  anchored: number;
  status: string;
  created_at: string;
}

const VALID_STATES: ReadonlySet<PrReviewState> = new Set(['incoming', 'analyzing', 'ready', 'submitted', 'dismissed']);
const VALID_VERDICTS: ReadonlySet<PrReviewVerdict> = new Set(['approve', 'request_changes', 'comment']);
const VALID_FINDING_STATUSES: ReadonlySet<PrReviewFindingStatus> = new Set(['open', 'dismissed', 'posted']);

function rowToReview(row: PrReviewRow): PrReview {
  return {
    id: row.id as PrReviewId,
    prUrl: row.pr_url,
    repoOwner: row.repo_owner,
    repoName: row.repo_name,
    prNumber: row.pr_number,
    prTitle: row.pr_title ?? undefined,
    prAuthor: row.pr_author ?? undefined,
    prBranch: row.pr_branch ?? undefined,
    prBody: row.pr_body ?? undefined,
    headSha: row.head_sha ?? undefined,
    state: VALID_STATES.has(row.state as PrReviewState) ? (row.state as PrReviewState) : 'incoming',
    discoveredVia: (row.discovered_via === 'manual' ? 'manual' : 'poll') as PrReviewDiscoveredVia,
    sessionId: (row.session_id ?? undefined) as SessionId | undefined,
    draftSummary: row.draft_summary ?? undefined,
    suggestedVerdict: VALID_VERDICTS.has(row.suggested_verdict as PrReviewVerdict)
      ? (row.suggested_verdict as PrReviewVerdict)
      : undefined,
    submittedAt: row.submitted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToFinding(row: PrReviewFindingRow): PrReviewFinding {
  return {
    id: row.id as PrReviewFindingId,
    reviewId: row.review_id as PrReviewId,
    file: row.file,
    line: row.line ?? undefined,
    side: row.side === 'LEFT' ? 'LEFT' : 'RIGHT',
    category: row.category ?? undefined,
    summary: row.summary,
    failureScenario: row.failure_scenario ?? undefined,
    suggestedComment: row.suggested_comment,
    codeContext: row.code_context ?? undefined,
    anchored: row.anchored === 1,
    status: VALID_FINDING_STATUSES.has(row.status as PrReviewFindingStatus)
      ? (row.status as PrReviewFindingStatus)
      : 'open',
    createdAt: row.created_at,
  };
}

export function createPrReviewRepository(): PrReviewRepository {
  const db = getDatabase();

  const findAllStmt = db.prepare('SELECT * FROM pr_reviews ORDER BY created_at DESC');
  const findByIdStmt = db.prepare('SELECT * FROM pr_reviews WHERE id = ?');
  const findByUrlStmt = db.prepare('SELECT * FROM pr_reviews WHERE pr_url = ?');
  const insertStmt = db.prepare(`
    INSERT INTO pr_reviews (
      id, pr_url, repo_owner, repo_name, pr_number, pr_title, pr_author, pr_branch, pr_body,
      state, discovered_via, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'incoming', ?, ?, ?)
  `);
  const deleteStmt = db.prepare('DELETE FROM pr_reviews WHERE id = ?');
  const findingsStmt = db.prepare('SELECT * FROM pr_review_findings WHERE review_id = ? ORDER BY file ASC, line ASC');
  const deleteFindingsStmt = db.prepare('DELETE FROM pr_review_findings WHERE review_id = ?');
  const insertFindingStmt = db.prepare(`
    INSERT INTO pr_review_findings (
      id, review_id, file, line, side, category, summary, failure_scenario,
      suggested_comment, code_context, anchored, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
  `);
  const findFindingStmt = db.prepare('SELECT * FROM pr_review_findings WHERE id = ?');
  const markPostedStmt = db.prepare(`UPDATE pr_review_findings SET status = 'posted' WHERE review_id = ? AND status = 'open'`);
  const countStmt = db.prepare(`
    SELECT review_id, SUM(status = 'open') AS open, COUNT(*) AS total
    FROM pr_review_findings GROUP BY review_id
  `);

  return {
    findAll(): PrReview[] {
      return (findAllStmt.all() as PrReviewRow[]).map(rowToReview);
    },

    findById(id: PrReviewId): PrReview | null {
      const row = findByIdStmt.get(id) as PrReviewRow | undefined;
      return row ? rowToReview(row) : null;
    },

    findByUrl(prUrl: string): PrReview | null {
      const row = findByUrlStmt.get(prUrl) as PrReviewRow | undefined;
      return row ? rowToReview(row) : null;
    },

    upsertIncoming(reg: PrReviewRegistration): PrReview {
      const existing = this.findByUrl(reg.prUrl);
      if (existing) return existing;
      const now = new Date().toISOString();
      const id = uuid();
      insertStmt.run(
        id,
        reg.prUrl,
        reg.repoOwner,
        reg.repoName,
        reg.prNumber,
        reg.prTitle ?? null,
        reg.prAuthor ?? null,
        reg.prBranch ?? null,
        reg.prBody ?? null,
        reg.discoveredVia,
        now,
        now,
      );
      return this.findById(id as PrReviewId)!;
    },

    update(id: PrReviewId, patch: PrReviewPatch): PrReview | null {
      const existing = this.findById(id);
      if (!existing) return null;
      const sets: string[] = ['updated_at = ?'];
      const values: unknown[] = [new Date().toISOString()];
      const columns: Array<[keyof PrReviewPatch, string]> = [
        ['state', 'state'],
        ['sessionId', 'session_id'],
        ['prTitle', 'pr_title'],
        ['prAuthor', 'pr_author'],
        ['prBranch', 'pr_branch'],
        ['headSha', 'head_sha'],
        ['draftSummary', 'draft_summary'],
        ['suggestedVerdict', 'suggested_verdict'],
        ['submittedAt', 'submitted_at'],
      ];
      for (const [key, column] of columns) {
        if (patch[key] !== undefined) {
          sets.push(`${column} = ?`);
          values.push(patch[key]);
        }
      }
      db.prepare(`UPDATE pr_reviews SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
      return this.findById(id);
    },

    delete(id: PrReviewId): boolean {
      return deleteStmt.run(id).changes > 0;
    },

    replaceFindings(reviewId: PrReviewId, findings: PrReviewFindingInput[]): PrReviewFinding[] {
      const now = new Date().toISOString();
      const replace = db.transaction(() => {
        deleteFindingsStmt.run(reviewId);
        for (const f of findings) {
          insertFindingStmt.run(
            uuid(),
            reviewId,
            f.file,
            f.line ?? null,
            f.side ?? 'RIGHT',
            f.category ?? null,
            f.summary,
            f.failureScenario ?? null,
            f.suggestedComment,
            f.codeContext ?? null,
            f.anchored ? 1 : 0,
            now,
          );
        }
      });
      replace();
      return this.findingsByReview(reviewId);
    },

    findingsByReview(reviewId: PrReviewId): PrReviewFinding[] {
      return (findingsStmt.all(reviewId) as PrReviewFindingRow[]).map(rowToFinding);
    },

    updateFinding(id: PrReviewFindingId, patch: PrReviewFindingPatch): PrReviewFinding | null {
      const row = findFindingStmt.get(id) as PrReviewFindingRow | undefined;
      if (!row) return null;
      const sets: string[] = [];
      const values: unknown[] = [];
      if (patch.status !== undefined) {
        sets.push('status = ?');
        values.push(patch.status);
      }
      if (patch.suggestedComment !== undefined) {
        sets.push('suggested_comment = ?');
        values.push(patch.suggestedComment);
      }
      if (sets.length > 0) {
        db.prepare(`UPDATE pr_review_findings SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
      }
      const updated = findFindingStmt.get(id) as PrReviewFindingRow;
      return rowToFinding(updated);
    },

    markOpenFindingsPosted(reviewId: PrReviewId): void {
      markPostedStmt.run(reviewId);
    },

    countFindings(): Map<PrReviewId, { open: number; total: number }> {
      const rows = countStmt.all() as Array<{ review_id: string; open: number; total: number }>;
      return new Map(rows.map((r) => [r.review_id as PrReviewId, { open: r.open, total: r.total }]));
    },
  };
}
