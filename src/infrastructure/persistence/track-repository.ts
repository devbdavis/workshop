import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { TrackRepository } from '@domain/track/repository';
import type { Track, TrackId, TrackRepo, TrackPath, RepoId, PathId, TemplateId } from '@foundation/types';

export function createTrackRepository(): TrackRepository {
  const db = getDatabase();

  return {
    findAll(): Track[] {
      const rows = db.prepare('SELECT * FROM tracks WHERE status != ? ORDER BY updated_at DESC').all('archived') as TrackRow[];
      return rows.map(rowToTrack);
    },

    findById(id: TrackId): Track | null {
      const row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as TrackRow | undefined;
      if (!row) return null;
      const track = rowToTrack(row);
      track.repos = this.findReposByTrack(id);
      track.paths = this.findPathsByTrack(id);
      return track;
    },

    create(data): Track {
      const id = uuid() as TrackId;
      const now = new Date().toISOString();
      db.prepare(
        'INSERT INTO tracks (id, name, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(id, data.name, data.description || null, data.status || 'active', now, now);
      return { id, name: data.name, description: data.description, status: data.status || 'active', createdAt: now, updatedAt: now };
    },

    update(id: TrackId, data): Track | null {
      const existing = this.findById(id);
      if (!existing) return null;
      const now = new Date().toISOString();
      const name = data.name ?? existing.name;
      const description = data.description ?? existing.description;
      const status = data.status ?? existing.status;
      db.prepare(
        'UPDATE tracks SET name = ?, description = ?, status = ?, updated_at = ? WHERE id = ?',
      ).run(name, description || null, status, now, id);
      return { ...existing, name, description, status, updatedAt: now };
    },

    delete(id: TrackId): boolean {
      const result = db.prepare('DELETE FROM tracks WHERE id = ?').run(id);
      return result.changes > 0;
    },

    setDefaultPromptTemplate(trackId: TrackId, templateId: TemplateId | null): boolean {
      const result = db.prepare(
        'UPDATE tracks SET default_prompt_template_id = ?, updated_at = ? WHERE id = ?',
      ).run(templateId, new Date().toISOString(), trackId);
      return result.changes > 0;
    },

    addRepo(trackId: TrackId, path: string, remoteUrl?: string): TrackRepo {
      const id = uuid() as RepoId;
      const now = new Date().toISOString();
      db.prepare(
        'INSERT INTO track_repos (id, track_id, path, remote_url, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(id, trackId, path, remoteUrl || null, now);
      return { id, trackId, path, remoteUrl, createdAt: now };
    },

    removeRepo(repoId: RepoId): boolean {
      const result = db.prepare('DELETE FROM track_repos WHERE id = ?').run(repoId);
      return result.changes > 0;
    },

    findReposByTrack(trackId: TrackId): TrackRepo[] {
      const rows = db.prepare('SELECT * FROM track_repos WHERE track_id = ?').all(trackId) as RepoRow[];
      return rows.map(rowToRepo);
    },

    addPath(trackId: TrackId, path: string, label?: string): TrackPath {
      const id = uuid() as PathId;
      const now = new Date().toISOString();
      db.prepare(
        'INSERT INTO track_paths (id, track_id, path, label, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(id, trackId, path, label || null, now);
      return { id, trackId, path, label, createdAt: now };
    },

    removePath(pathId: PathId): boolean {
      const result = db.prepare('DELETE FROM track_paths WHERE id = ?').run(pathId);
      return result.changes > 0;
    },

    findPathsByTrack(trackId: TrackId): TrackPath[] {
      const rows = db.prepare('SELECT * FROM track_paths WHERE track_id = ?').all(trackId) as PathRow[];
      return rows.map(rowToPath);
    },
  };
}

// Row types and mappers

interface TrackRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  default_prompt_template_id: string | null;
  created_at: string;
  updated_at: string;
}

interface RepoRow {
  id: string;
  track_id: string;
  path: string;
  remote_url: string | null;
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
  return {
    id: row.id as TrackId,
    name: row.name,
    description: row.description || undefined,
    status: row.status as Track['status'],
    defaultPromptTemplateId: (row.default_prompt_template_id as TemplateId) || undefined,
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
