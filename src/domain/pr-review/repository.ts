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

/** Shape used to register a newly discovered or manually added PR. */
export interface PrReviewRegistration {
  prUrl: string;
  repoOwner: string;
  repoName: string;
  prNumber: number;
  prTitle?: string;
  prAuthor?: string;
  prBranch?: string;
  discoveredVia: PrReviewDiscoveredVia;
}

/** Mutable fields on a review row. Omitted keys are left untouched. */
export interface PrReviewPatch {
  state?: PrReviewState;
  sessionId?: SessionId;
  prTitle?: string;
  prAuthor?: string;
  prBranch?: string;
  headSha?: string;
  draftSummary?: string;
  suggestedVerdict?: PrReviewVerdict;
  submittedAt?: string;
}

/** One structured finding as reported by the pr-review agent. */
export interface PrReviewFindingInput {
  file: string;
  line?: number;
  side?: 'LEFT' | 'RIGHT';
  category?: string;
  summary: string;
  failureScenario?: string;
  suggestedComment: string;
  codeContext?: string;
  anchored: boolean;
}

export interface PrReviewFindingPatch {
  status?: PrReviewFindingStatus;
  suggestedComment?: string;
}

export interface PrReviewRepository {
  findAll(): PrReview[];
  findById(id: PrReviewId): PrReview | null;
  findByUrl(prUrl: string): PrReview | null;
  /** Idempotent by prUrl — an existing row is returned untouched (poll must not clobber user state). */
  upsertIncoming(reg: PrReviewRegistration): PrReview;
  update(id: PrReviewId, patch: PrReviewPatch): PrReview | null;
  delete(id: PrReviewId): boolean;
  /** Atomically replaces all findings for a review (re-analysis discards the previous set). */
  replaceFindings(reviewId: PrReviewId, findings: PrReviewFindingInput[]): PrReviewFinding[];
  findingsByReview(reviewId: PrReviewId): PrReviewFinding[];
  updateFinding(id: PrReviewFindingId, patch: PrReviewFindingPatch): PrReviewFinding | null;
  /** Marks all non-dismissed findings for a review as posted (after a successful submit). */
  markOpenFindingsPosted(reviewId: PrReviewId): void;
  /** Open-finding counts per review, for the dashboard list. */
  countFindings(): Map<PrReviewId, { open: number; total: number }>;
}
