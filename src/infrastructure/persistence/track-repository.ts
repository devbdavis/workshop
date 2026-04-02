import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { TrackRepository } from '@domain/track/repository';
import type { Track, TrackId, TrackRepo, TrackPath, RepoId, PathId, AgentId, TemplateId, TerminalLayout, GlobalRepoId } from '@foundation/types';

export function createTrackRepository(): TrackRepository {
  const db = getDatabase();

  // Prepare statements once
  const findAllStmt = db.prepare('SELECT * FROM tracks WHERE status != ? ORDER BY updated_at DESC');
  const findByIdStmt = db.prepare('SELECT * FROM tracks WHERE id = ?');
  const findByMatrixRoomIdStmt = db.prepare('SELECT * FROM tracks WHERE matrix_room_id = ?');
  const insertStmt = db.prepare(
    'INSERT INTO tracks (id, name, description, context, label, matrix_room_id, worktree_mode, default_agent_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const updateStmt = db.prepare(
    'UPDATE tracks SET name = ?, description = ?, context = ?, label = ?, matrix_room_id = ?, worktree_mode = ?, default_agent_id = ?, status = ?, updated_at = ? WHERE id = ?',
  );
  const deleteStmt = db.prepare('DELETE FROM tracks WHERE id = ?');
  const setDefaultPromptTemplateStmt = db.prepare(
    'UPDATE tracks SET default_prompt_template_id = ?, updated_at = ? WHERE id = ?',
  );
  const setDefaultAgentStmt = db.prepare(
    'UPDATE tracks SET default_agent_id = ?, updated_at = ? WHERE id = ?',
  );
  const insertRepoStmt = db.prepare(
    'INSERT INTO track_repos (id, track_id, path, remote_url, repo_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const deleteRepoStmt = db.prepare('DELETE FROM track_repos WHERE id = ?');
  const findReposByTrackStmt = db.prepare('SELECT * FROM track_repos WHERE track_id = ?');
  const insertPathStmt = db.prepare(
    'INSERT INTO track_paths (id, track_id, path, label, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const deletePathStmt = db.prepare('DELETE FROM track_paths WHERE id = ?');
  const findPathsByTrackStmt = db.prepare('SELECT * FROM track_paths WHERE track_id = ?');
  const getTerminalLayoutStmt = db.prepare('SELECT terminal_layout FROM tracks WHERE id = ?');
  const setTerminalLayoutStmt = db.prepare(
    'UPDATE tracks SET terminal_layout = ?, updated_at = ? WHERE id = ?',
  );

  return {
    findAll(): Track[] {
      const rows = findAllStmt.all('archived') as TrackRow[];
      return rows.map(rowToTrack);
    },

    findById(id: TrackId): Track | null {
      const row = findByIdStmt.get(id) as TrackRow | undefined;
      if (!row) return null;
      const track = rowToTrack(row);
      track.repos = this.findReposByTrack(id);
      track.paths = this.findPathsByTrack(id);
      return track;
    },

    findByMatrixRoomId(roomId: string): Track | null {
      const row = findByMatrixRoomIdStmt.get(roomId) as TrackRow | undefined;
      if (!row) return null;
      const track = rowToTrack(row);
      track.repos = this.findReposByTrack(track.id);
      track.paths = this.findPathsByTrack(track.id);
      return track;
    },

    create(data): Track {
      const id = uuid() as TrackId;
      const now = new Date().toISOString();
      // worktreeMode defaults to true — all new tracks use per-session git worktrees
      const worktreeMode = data.worktreeMode !== false;
      insertStmt.run(id, data.name, data.description || null, data.context || null, data.label || null, data.matrixRoomId || null, worktreeMode ? 1 : 0, data.defaultAgentId || null, data.status || 'active', now, now);
      return { id, name: data.name, description: data.description, context: data.context, label: data.label, matrixRoomId: data.matrixRoomId, worktreeMode, defaultAgentId: data.defaultAgentId, status: data.status || 'active', createdAt: now, updatedAt: now };
    },

    update(id: TrackId, data): Track | null {
      const existing = this.findById(id);
      if (!existing) return null;
      const now = new Date().toISOString();
      const name = data.name ?? existing.name;
      const description = data.description ?? existing.description;
      const context = data.context !== undefined ? data.context : existing.context;
      const label = data.label !== undefined ? data.label : existing.label;
      const matrixRoomId = data.matrixRoomId !== undefined ? data.matrixRoomId : existing.matrixRoomId;
      const worktreeMode = data.worktreeMode !== undefined ? data.worktreeMode : existing.worktreeMode;
      const defaultAgentId = data.defaultAgentId !== undefined ? data.defaultAgentId : existing.defaultAgentId;
      const status = data.status ?? existing.status;
      updateStmt.run(name, description || null, context || null, label || null, matrixRoomId || null, worktreeMode ? 1 : 0, defaultAgentId || null, status, now, id);
      return { ...existing, name, description, context, label, matrixRoomId, worktreeMode, defaultAgentId, status, updatedAt: now };
    },

    delete(id: TrackId): boolean {
      const result = deleteStmt.run(id);
      return result.changes > 0;
    },

    setDefaultPromptTemplate(trackId: TrackId, templateId: TemplateId | null): boolean {
      const result = setDefaultPromptTemplateStmt.run(templateId, new Date().toISOString(), trackId);
      return result.changes > 0;
    },

    setDefaultAgent(trackId: TrackId, agentId: AgentId | null): boolean {
      const result = setDefaultAgentStmt.run(agentId, new Date().toISOString(), trackId);
      return result.changes > 0;
    },

    addRepo(trackId: TrackId, path: string, remoteUrl?: string, repoId?: GlobalRepoId): TrackRepo {
      const id = uuid() as RepoId;
      const now = new Date().toISOString();
      insertRepoStmt.run(id, trackId, path, remoteUrl || null, repoId || null, now);
      return { id, trackId, path, remoteUrl, repoId, createdAt: now };
    },

    removeRepo(repoId: RepoId): boolean {
      const result = deleteRepoStmt.run(repoId);
      return result.changes > 0;
    },

    findReposByTrack(trackId: TrackId): TrackRepo[] {
      const rows = findReposByTrackStmt.all(trackId) as RepoRow[];
      return rows.map(rowToRepo);
    },

    addPath(trackId: TrackId, path: string, label?: string): TrackPath {
      const id = uuid() as PathId;
      const now = new Date().toISOString();
      insertPathStmt.run(id, trackId, path, label || null, now);
      return { id, trackId, path, label, createdAt: now };
    },

    removePath(pathId: PathId): boolean {
      const result = deletePathStmt.run(pathId);
      return result.changes > 0;
    },

    findPathsByTrack(trackId: TrackId): TrackPath[] {
      const rows = findPathsByTrackStmt.all(trackId) as PathRow[];
      return rows.map(rowToPath);
    },

    getTerminalLayout(trackId: TrackId): TerminalLayout | null {
      const row = getTerminalLayoutStmt.get(trackId) as { terminal_layout: string | null } | undefined;
      if (!row || !row.terminal_layout) return null;
      try {
        return JSON.parse(row.terminal_layout) as TerminalLayout;
      } catch {
        return null;
      }
    },

    setTerminalLayout(trackId: TrackId, layout: TerminalLayout | null): boolean {
      const json = layout ? JSON.stringify(layout) : null;
      const result = setTerminalLayoutStmt.run(json, new Date().toISOString(), trackId);
      return result.changes > 0;
    },
  };
}

// Row types and mappers

interface TrackRow {
  id: string;
  name: string;
  description: string | null;
  context: string | null;
  label: string | null;
  matrix_room_id: string | null;
  worktree_mode: number;
  default_agent_id: string | null;
  status: string;
  default_prompt_template_id: string | null;
  terminal_layout: string | null;
  created_at: string;
  updated_at: string;
}

interface RepoRow {
  id: string;
  track_id: string;
  path: string;
  remote_url: string | null;
  repo_id: string | null;
  created_at: string;
}

interface PathRow {
  id: string;
  track_id: string;
  path: string;
  label: string | null;
  created_at: string;
}

function rowToTrack(row: TrackRow): Track {
  let terminalLayout: TerminalLayout | undefined;
  if (row.terminal_layout) {
    try {
      terminalLayout = JSON.parse(row.terminal_layout) as TerminalLayout;
    } catch {
      // Ignore malformed JSON
    }
  }
  return {
    id: row.id as TrackId,
    name: row.name,
    description: row.description || undefined,
    context: row.context || undefined,
    label: row.label || undefined,
    matrixRoomId: row.matrix_room_id || undefined,
    worktreeMode: row.worktree_mode === 1 ? true : undefined,
    defaultAgentId: (row.default_agent_id as AgentId) || undefined,
    status: row.status as Track['status'],
    defaultPromptTemplateId: (row.default_prompt_template_id as TemplateId) || undefined,
    terminalLayout,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRepo(row: RepoRow): TrackRepo {
  return {
    id: row.id as RepoId,
    trackId: row.track_id as TrackId,
    path: row.path,
    remoteUrl: row.remote_url || undefined,
    repoId: (row.repo_id as GlobalRepoId) || undefined,
    createdAt: row.created_at,
  };
}

function rowToPath(row: PathRow): TrackPath {
  return {
    id: row.id as PathId,
    trackId: row.track_id as TrackId,
    path: row.path,
    label: row.label || undefined,
    createdAt: row.created_at,
  };
}
