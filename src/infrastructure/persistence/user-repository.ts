import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { UserRepository } from '@domain/user/repository';
import type { User, UserId, UserTrackPrefs, TrackId } from '@foundation/types';

interface UserRow {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
}

interface TrackPrefRow {
  user_id: string;
  track_id: string;
  is_favorite: number;
  is_hidden: number;
  updated_at: string;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id as UserId,
    name: row.name,
    color: row.color || undefined,
    createdAt: row.created_at,
  };
}

function rowToPrefs(row: TrackPrefRow): UserTrackPrefs {
  return {
    userId: row.user_id as UserId,
    trackId: row.track_id as TrackId,
    isFavorite: row.is_favorite === 1,
    isHidden: row.is_hidden === 1,
    updatedAt: row.updated_at,
  };
}

export function createUserRepository(): UserRepository {
  const db = getDatabase();

  const findAllStmt = db.prepare('SELECT * FROM users ORDER BY created_at ASC');
  const findByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');
  const insertStmt = db.prepare(
    'INSERT INTO users (id, name, color, created_at) VALUES (?, ?, ?, ?)',
  );
  const updateStmt = db.prepare('UPDATE users SET name = ?, color = ? WHERE id = ?');
  const deleteStmt = db.prepare('DELETE FROM users WHERE id = ?');

  const getSettingStmt = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?');
  const getAllSettingsStmt = db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?');
  const setSettingStmt = db.prepare(
    'INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)',
  );

  const getPrefsStmt = db.prepare('SELECT * FROM user_track_prefs WHERE user_id = ?');
  const getPrefStmt = db.prepare('SELECT * FROM user_track_prefs WHERE user_id = ? AND track_id = ?');
  const upsertPrefStmt = db.prepare(
    `INSERT INTO user_track_prefs (user_id, track_id, is_favorite, is_hidden, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, track_id) DO UPDATE SET
       is_favorite = excluded.is_favorite,
       is_hidden = excluded.is_hidden,
       updated_at = excluded.updated_at`,
  );

  return {
    findAll(): User[] {
      return (findAllStmt.all() as UserRow[]).map(rowToUser);
    },

    findById(id: UserId): User | null {
      const row = findByIdStmt.get(id) as UserRow | undefined;
      return row ? rowToUser(row) : null;
    },

    create(data): User {
      const id = uuid() as UserId;
      const now = new Date().toISOString();
      insertStmt.run(id, data.name, data.color || null, now);
      return { id, name: data.name, color: data.color, createdAt: now };
    },

    update(id: UserId, data): User | null {
      const existing = this.findById(id);
      if (!existing) return null;
      const name = data.name ?? existing.name;
      const color = data.color !== undefined ? data.color : existing.color;
      updateStmt.run(name, color || null, id);
      return { ...existing, name, color };
    },

    delete(id: UserId): boolean {
      return deleteStmt.run(id).changes > 0;
    },

    getSetting(userId: UserId, key: string): string | null {
      const row = getSettingStmt.get(userId, key) as { value: string } | undefined;
      return row ? row.value : null;
    },

    getAllSettings(userId: UserId): Record<string, string> {
      const rows = getAllSettingsStmt.all(userId) as Array<{ key: string; value: string }>;
      const out: Record<string, string> = {};
      for (const r of rows) out[r.key] = r.value;
      return out;
    },

    setSetting(userId: UserId, key: string, value: string): void {
      setSettingStmt.run(userId, key, value);
    },

    getTrackPrefs(userId: UserId): UserTrackPrefs[] {
      return (getPrefsStmt.all(userId) as TrackPrefRow[]).map(rowToPrefs);
    },

    setTrackPref(userId: UserId, trackId: TrackId, pref): UserTrackPrefs {
      const existing = getPrefStmt.get(userId, trackId) as TrackPrefRow | undefined;
      const isFavorite = pref.isFavorite !== undefined ? pref.isFavorite : existing?.is_favorite === 1;
      const isHidden = pref.isHidden !== undefined ? pref.isHidden : existing?.is_hidden === 1;
      const now = new Date().toISOString();
      upsertPrefStmt.run(userId, trackId, isFavorite ? 1 : 0, isHidden ? 1 : 0, now);
      return { userId, trackId, isFavorite, isHidden, updatedAt: now };
    },
  };
}
