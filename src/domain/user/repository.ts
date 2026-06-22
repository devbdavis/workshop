import type { User, UserId, UserTrackPrefs, TrackId } from '@foundation/types';

export interface UserRepository {
  // Profiles
  findAll(): User[];
  findById(id: UserId): User | null;
  create(data: Pick<User, 'name' | 'color'>): User;
  update(id: UserId, data: Partial<Pick<User, 'name' | 'color'>>): User | null;
  delete(id: UserId): boolean;

  // Per-user key/value settings (theme, editor launch, etc.)
  getSetting(userId: UserId, key: string): string | null;
  getAllSettings(userId: UserId): Record<string, string>;
  setSetting(userId: UserId, key: string, value: string): void;

  // Per-user, per-track preferences
  getTrackPrefs(userId: UserId): UserTrackPrefs[];
  setTrackPref(
    userId: UserId,
    trackId: TrackId,
    pref: Partial<Pick<UserTrackPrefs, 'isFavorite' | 'isHidden'>>,
  ): UserTrackPrefs;
}
