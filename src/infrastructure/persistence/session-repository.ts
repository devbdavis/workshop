import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { SessionRepository } from '@domain/session/repository';
import type { Session, SessionId, SessionProvider, SessionState, TrackId } from '@foundation/types';

export function createSessionRepository(): SessionRepository {
  const db = getDatabase();

  // Prepare statements once
  const findByIdStmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
  const findByTrackStmt = db.prepare('SELECT * FROM sessions WHERE track_id = ? AND deleted_at IS NULL ORDER BY created_at DESC');
  const findDeletedByTrackStmt = db.prepare('SELECT * FROM sessions WHERE track_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC');
  const findAllDeletedStmt = db.prepare('SELECT * FROM sessions WHERE deleted_at IS NOT NULL ORDER BY deleted_at ASC');
  const findByTmuxSessionStmt = db.prepare('SELECT * FROM sessions WHERE tmux_session = ?');
  const findAllStmt = db.prepare('SELECT * FROM sessions WHERE deleted_at IS NULL ORDER BY created_at DESC');
  const insertStmt = db.prepare(
    'INSERT INTO sessions (id, track_id, name, tmux_session, claude_resume_id, system_prompt, state, provider, background, worktree_root, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const updateStateStmt = db.prepare('UPDATE sessions SET state = ?, updated_at = ? WHERE id = ?');
  const updateNameStmt = db.prepare('UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?');
  const updateClaudeResumeIdStmt = db.prepare('UPDATE sessions SET claude_resume_id = ?, updated_at = ? WHERE id = ?');
  const updateTmuxSessionStmt = db.prepare('UPDATE sessions SET tmux_session = ?, updated_at = ? WHERE id = ?');
  const updateWorktreeRootStmt = db.prepare('UPDATE sessions SET worktree_root = ?, updated_at = ? WHERE id = ?');
  const updateWorkingDirectoryStmt = db.prepare('UPDATE sessions SET working_directory = ?, updated_at = ? WHERE id = ?');
  const softDeleteStmt = db.prepare('UPDATE sessions SET deleted_at = ?, state = ?, updated_at = ? WHERE id = ?');
  const restoreStmt = db.prepare('UPDATE sessions SET deleted_at = NULL, state = ?, updated_at = ? WHERE id = ?');
  const deleteStmt = db.prepare('DELETE FROM sessions WHERE id = ?');

  return {
    findById(id: SessionId): Session | null {
      const row = findByIdStmt.get(id) as SessionRow | undefined;
      return row ? rowToSession(row) : null;
    },

    findByTrack(trackId: TrackId): Session[] {
      const rows = findByTrackStmt.all(trackId) as SessionRow[];
      return rows.map(rowToSession);
    },

    findDeletedByTrack(trackId: TrackId): Session[] {
      const rows = findDeletedByTrackStmt.all(trackId) as SessionRow[];
      return rows.map(rowToSession);
    },

    findAllDeleted(): Session[] {
      const rows = findAllDeletedStmt.all() as SessionRow[];
      return rows.map(rowToSession);
    },

    findByTmuxSession(tmuxSession: string): Session | null {
      const row = findByTmuxSessionStmt.get(tmuxSession) as SessionRow | undefined;
      return row ? rowToSession(row) : null;
    },

    findAll(): Session[] {
      const rows = findAllStmt.all() as SessionRow[];
      return rows.map(rowToSession);
    },

    create(data): Session {
      const id = uuid() as SessionId;
      const now = new Date().toISOString();
      const provider = data.provider || 'claude';
      insertStmt.run(id, data.trackId, data.name || null, data.tmuxSession, data.claudeResumeId || null, data.systemPrompt || null, data.state, provider, data.background ? 1 : 0, data.worktreeRoot || null, data.workingDirectory || null, now, now);
      return {
        id,
        trackId: data.trackId,
        name: data.name,
        tmuxSession: data.tmuxSession,
        claudeResumeId: data.claudeResumeId,
        systemPrompt: data.systemPrompt,
        state: data.state,
        provider,
        background: data.background ?? false,
        worktreeRoot: data.worktreeRoot,
        workingDirectory: data.workingDirectory,
        createdAt: now,
        updatedAt: now,
      };
    },

    updateState(id: SessionId, state: SessionState): Session | null {
      const now = new Date().toISOString();
      const result = updateStateStmt.run(state, now, id);
      if (result.changes === 0) return null;
      return this.findById(id);
    },

    updateName(id: SessionId, name: string): Session | null {
      const now = new Date().toISOString();
      const result = updateNameStmt.run(name, now, id);
      if (result.changes === 0) return null;
      return this.findById(id);
    },

    updateClaudeResumeId(id: SessionId, claudeResumeId: string): Session | null {
      const now = new Date().toISOString();
      const result = updateClaudeResumeIdStmt.run(claudeResumeId, now, id);
      if (result.changes === 0) return null;
      return this.findById(id);
    },

    updateTmuxSession(id: SessionId, tmuxSession: string): Session | null {
      const now = new Date().toISOString();
      const result = updateTmuxSessionStmt.run(tmuxSession, now, id);
      if (result.changes === 0) return null;
      return this.findById(id);
    },

    updateWorktreeRoot(id: SessionId, worktreeRoot: string): Session | null {
      const now = new Date().toISOString();
      const result = updateWorktreeRootStmt.run(worktreeRoot, now, id);
      if (result.changes === 0) return null;
      return this.findById(id);
    },

    updateWorkingDirectory(id: SessionId, workingDirectory: string): Session | null {
      const now = new Date().toISOString();
      const result = updateWorkingDirectoryStmt.run(workingDirectory, now, id);
      if (result.changes === 0) return null;
      return this.findById(id);
    },

    softDelete(id: SessionId): Session | null {
      const now = new Date().toISOString();
      const result = softDeleteStmt.run(now, 'dead', now, id);
      if (result.changes === 0) return null;
      return this.findById(id);
    },

    restore(id: SessionId): Session | null {
      const session = this.findById(id);
      if (!session) return null;
      const now = new Date().toISOString();
      // Use 'suspended' so the sync loop doesn't immediately reap it;
      // resumeSuspendedSessions will auto-resume if a claudeResumeId is present.
      const result = restoreStmt.run('suspended', now, id);
      if (result.changes === 0) return null;
      return this.findById(id);
    },

    delete(id: SessionId): boolean {
      const result = deleteStmt.run(id);
      return result.changes > 0;
    },
  };
}

interface SessionRow {
  id: string;
  track_id: string;
  name: string | null;
  tmux_session: string;
  claude_resume_id: string | null;
  system_prompt: string | null;
  state: string;
  provider: string | null;
  background: number;
  worktree_root: string | null;
  working_directory: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id as SessionId,
    trackId: row.track_id as TrackId,
    name: row.name || undefined,
    tmuxSession: row.tmux_session,
    claudeResumeId: row.claude_resume_id || undefined,
    systemPrompt: row.system_prompt || undefined,
    state: row.state as SessionState,
    provider: (row.provider as SessionProvider) || 'claude',
    background: row.background === 1,
    worktreeRoot: row.worktree_root || undefined,
    workingDirectory: row.working_directory || undefined,
    deletedAt: row.deleted_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
