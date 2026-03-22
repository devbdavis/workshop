import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { getDatabase } from './database.js';
import type {
  WorkflowReviewRepository,
  WorkflowReviewRow,
  PerStateTiming,
} from '@application/workflow/review-repository.js';
import { ReviewFindingSchema, SuggestedChangeSchema } from '@application/workflow/schemas.js';

// ---------------------------------------------------------------------------
// SQLite implementation of WorkflowReviewRepository
// ---------------------------------------------------------------------------

// Zod schemas for array parsing
const ReviewFindingsArraySchema = z.array(ReviewFindingSchema);
const SuggestedChangesArraySchema = z.array(SuggestedChangeSchema);
const PerStateTimingSchema = z.record(
  z.string(),
  z.object({
    enteredAt: z.string(),
    exitedAt: z.string(),
    durationMs: z.number(),
  }),
);

export function createWorkflowReviewRepository(): WorkflowReviewRepository {
  const db = getDatabase();

  // Prepared statements
  const findByIdStmt = db.prepare('SELECT * FROM workflow_reviews WHERE id = ?');
  const findByTemplateStmt = db.prepare(
    'SELECT * FROM workflow_reviews WHERE template_row_id = ? ORDER BY created_at DESC',
  );
  const findByEpicStmt = db.prepare('SELECT * FROM workflow_reviews WHERE epic_id = ? LIMIT 1');

  const insertStmt = db.prepare(`
    INSERT INTO workflow_reviews
    (id, template_row_id, epic_id, structured_findings, suggested_changes,
     per_state_timing, human_approved, applied_as_version, created_at, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateStmt = db.prepare(`
    UPDATE workflow_reviews SET
      structured_findings = ?, suggested_changes = ?, per_state_timing = ?,
      human_approved = ?, applied_as_version = ?, reviewed_at = ?
    WHERE id = ?
  `);

  return {
    findById(id: string): WorkflowReviewRow | null {
      const row = findByIdStmt.get(id) as ReviewDbRow | undefined;
      return row ? rowToReview(row) : null;
    },

    findByTemplate(templateRowId: string): WorkflowReviewRow[] {
      const rows = findByTemplateStmt.all(templateRowId) as ReviewDbRow[];
      return rows.map(rowToReview);
    },

    findByEpic(epicId: string): WorkflowReviewRow | null {
      const row = findByEpicStmt.get(epicId) as ReviewDbRow | undefined;
      return row ? rowToReview(row) : null;
    },

    create(review: Omit<WorkflowReviewRow, 'id' | 'createdAt'>): WorkflowReviewRow {
      const id = uuid();
      const now = new Date().toISOString();

      insertStmt.run(
        id,
        review.templateRowId,
        review.epicId,
        JSON.stringify(review.structuredFindings),
        review.suggestedChanges ? JSON.stringify(review.suggestedChanges) : null,
        review.perStateTiming ? JSON.stringify(review.perStateTiming) : null,
        review.humanApproved !== undefined ? (review.humanApproved ? 1 : 0) : null,
        review.appliedAsVersion ?? null,
        now,
        review.reviewedAt ?? null,
      );

      return {
        id,
        ...review,
        createdAt: now,
      };
    },

    update(id: string, changes: Partial<WorkflowReviewRow>): WorkflowReviewRow | null {
      const existing = this.findById(id);
      if (!existing) return null;

      const merged: WorkflowReviewRow = {
        ...existing,
        structuredFindings: changes.structuredFindings ?? existing.structuredFindings,
        suggestedChanges: changes.suggestedChanges !== undefined
          ? changes.suggestedChanges
          : existing.suggestedChanges,
        perStateTiming: changes.perStateTiming !== undefined
          ? changes.perStateTiming
          : existing.perStateTiming,
        humanApproved: changes.humanApproved !== undefined
          ? changes.humanApproved
          : existing.humanApproved,
        appliedAsVersion: changes.appliedAsVersion !== undefined
          ? changes.appliedAsVersion
          : existing.appliedAsVersion,
        reviewedAt: changes.reviewedAt !== undefined
          ? changes.reviewedAt
          : existing.reviewedAt,
      };

      updateStmt.run(
        JSON.stringify(merged.structuredFindings),
        merged.suggestedChanges ? JSON.stringify(merged.suggestedChanges) : null,
        merged.perStateTiming ? JSON.stringify(merged.perStateTiming) : null,
        merged.humanApproved !== undefined ? (merged.humanApproved ? 1 : 0) : null,
        merged.appliedAsVersion ?? null,
        merged.reviewedAt ?? null,
        id,
      );

      return merged;
    },
  };
}

// ---------------------------------------------------------------------------
// Row type and mapper
// ---------------------------------------------------------------------------

interface ReviewDbRow {
  id: string;
  template_row_id: string;
  epic_id: string;
  structured_findings: string;
  suggested_changes: string | null;
  per_state_timing: string | null;
  human_approved: number | null;
  applied_as_version: number | null;
  created_at: string;
  reviewed_at: string | null;
}

function rowToReview(row: ReviewDbRow): WorkflowReviewRow {
  return {
    id: row.id,
    templateRowId: row.template_row_id,
    epicId: row.epic_id,
    structuredFindings: ReviewFindingsArraySchema.parse(JSON.parse(row.structured_findings)),
    suggestedChanges: row.suggested_changes
      ? SuggestedChangesArraySchema.parse(JSON.parse(row.suggested_changes))
      : undefined,
    perStateTiming: row.per_state_timing
      ? (PerStateTimingSchema.parse(JSON.parse(row.per_state_timing)) as Record<string, PerStateTiming>)
      : undefined,
    humanApproved: row.human_approved !== null ? row.human_approved === 1 : undefined,
    appliedAsVersion: row.applied_as_version ?? undefined,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at ?? undefined,
  };
}
