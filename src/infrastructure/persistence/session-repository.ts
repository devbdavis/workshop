import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { SessionRepository } from '@domain/session/repository';
import type { Session, SessionId, SessionProvider, SessionState, TrackId } from '@foundation/types';

export function createSessionRepository(): SessionRepository {
  const db = getDatabase();

  return {
    findById(id: SessionId): Session | null {
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
      return row ? rowToSession(row) : null;
    },

    findByTrack(trackId: TrackId): Session[] {
      const rows = db.prepare('SELECT * FROM sessions WHERE track_id = ? ORDER BY created_at DESC').all(trackId) as SessionRow[];
      return rows.map(rowToSession);
    },

    findByTmuxSession(tmuxSession: string): Session | null {
      const row = db.prepare('SELECT * FROM sessions WHERE tmux_session = ?').get(tmuxSession) as SessionRow | undefined;
      return row ? rowToSession(row) : null;
    },

    findAll(): Session[] {
      const rows = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all() as SessionRow[];
      return rows.map(rowToSession);
    },

    create(data): Session {
      const id = uuid() as SessionId;
      const now = new Date().toISOString();
      const provider = data.provider || 'claude';
      db.prepare(
        'INSERT INTO sessions (id, track_id, name, tmux_session, claude_resume_id, system_prompt, state, provider, background, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, data.trackId, data.name || null, data.tmuxSession, data.claudeResumeId || null, data.systemPrompt || null, data.state, provider, data.background ? 1 : 0, now, now);
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
        createdAt: now,
        updatedAt: now,
      };
    },

    updateState(id: SessionId, state: SessionState): Session | null {
      const now = new Date().toISOString();
      const result = db.prepare('UPDATE sessions SET state = ?, updated_at = ? WHERE id = ?').run(state, now, id);
      if (result.changes === 0) return null;
      return this.findById(id);
    },

    updateName(id: SessionId, name: string): Session | null {
      const now = new Date().toISOString();
      const result = db.prepare('UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?').run(name, now, id);
      if (result.changes === 0) return null;
      return this.findById(id);
    },

    updateClaudeResumeId(id: SessionId, claudeResumeId: string): Session | null {
      const now = new Date().toISOString();
      const result = db.prepare('UPDATE sessions SET claude_resume_id = ?, updated_at = ? WHERE id = ?').run(claudeResumeId, now, id);
      if (result.changes === 0) return null;
      return this.findById(id);
    },

    delete(id: SessionId): boolean {
      const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
