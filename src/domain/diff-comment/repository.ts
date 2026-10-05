import type { DiffComment, DiffCommentId, DiffCommentStatus, SessionId } from '@foundation/types';

/** Shape used to create a new comment. */
export interface DiffCommentInput {
  sessionId: SessionId;
  file: string;
  line: number;
  lineText: string;
  body: string;
  codeContext?: string;
}

/** Mutable fields on a comment row. Omitted keys are left untouched. */
export interface DiffCommentPatch {
  body?: string;
  status?: DiffCommentStatus;
  line?: number;
  anchored?: boolean;
  codeContext?: string;
  sentAt?: string;
}

export interface DiffCommentRepository {
  findBySession(sessionId: SessionId): DiffComment[];
  findById(id: DiffCommentId): DiffComment | null;
  create(input: DiffCommentInput): DiffComment;
  update(id: DiffCommentId, patch: DiffCommentPatch): DiffComment | null;
  delete(id: DiffCommentId): boolean;
}
