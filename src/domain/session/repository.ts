import type { Session, SessionId, SessionState, TrackId } from '@foundation/types';

export interface SessionRepository {
  findById(id: SessionId): Session | null;
  findByTrack(trackId: TrackId): Session[];
  /** Sessions in the recycle bin for a specific track, ordered by deletion date desc. */
  findDeletedByTrack(trackId: TrackId): Session[];
  /** All sessions in the recycle bin across all tracks, ordered by deletion date asc. */
  findAllDeleted(): Session[];
  findByTmuxSession(tmuxSession: string): Session | null;
  findAll(): Session[];
  create(session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>): Session;
  updateState(id: SessionId, state: SessionState): Session | null;
  updateName(id: SessionId, name: string): Session | null;
  updateClaudeResumeId(id: SessionId, claudeResumeId: string): Session | null;
  updateTmuxSession(id: SessionId, tmuxSession: string): Session | null;
  updateWorktreeRoot(id: SessionId, worktreeRoot: string): Session | null;
  /** Move a session to the recycle bin (sets deleted_at, state → 'dead'). */
  softDelete(id: SessionId): Session | null;
  /** Restore a session from the recycle bin (clears deleted_at, state → 'suspended'). */
  restore(id: SessionId): Session | null;
  /** Hard-delete from the database. Used by terminal manager cleanup and permanent purge. */
  delete(id: SessionId): boolean;
}
