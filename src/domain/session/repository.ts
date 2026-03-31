import type { Session, SessionId, SessionState, TrackId } from '@foundation/types';

export interface SessionRepository {
  findById(id: SessionId): Session | null;
  findByTrack(trackId: TrackId): Session[];
  findByTmuxSession(tmuxSession: string): Session | null;
  findAll(): Session[];
  create(session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>): Session;
  updateState(id: SessionId, state: SessionState): Session | null;
  updateName(id: SessionId, name: string): Session | null;
  updateClaudeResumeId(id: SessionId, claudeResumeId: string): Session | null;
  updateTmuxSession(id: SessionId, tmuxSession: string): Session | null;
  updateWorktreeRoot(id: SessionId, worktreeRoot: string): Session | null;
  delete(id: SessionId): boolean;
}
