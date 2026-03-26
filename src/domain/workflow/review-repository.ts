import type { ReviewFinding, SuggestedChange } from './types.js';

export interface PerStateTiming {
  enteredAt: string;
  exitedAt: string;
  durationMs: number;
}

export interface WorkflowReviewRow {
  id: string;
  playbookRowId: string;
  epicId: string;
  structuredFindings: ReviewFinding[];
  suggestedChanges?: SuggestedChange[];
  perStateTiming?: Record<string, PerStateTiming>;
  humanApproved?: boolean;
  appliedAsVersion?: number;
  createdAt: string;
  reviewedAt?: string;
}

export interface WorkflowReviewRepository {
  findById(id: string): WorkflowReviewRow | null;
  findByPlaybook(playbookRowId: string): WorkflowReviewRow[];
  findByEpic(epicId: string): WorkflowReviewRow | null;
  create(review: Omit<WorkflowReviewRow, 'id' | 'createdAt'>): WorkflowReviewRow;
  update(id: string, changes: Partial<WorkflowReviewRow>): WorkflowReviewRow | null;
}
