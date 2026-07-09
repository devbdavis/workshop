import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

export interface Profile {
  id: string;
  name: string;
  color?: string;
  createdAt: string;
}

interface ProfileContextValue {
  /** The active profile, or null if none selected yet. */
  user: Profile | null;
  /** All profiles on this server. */
  users: Profile[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** Select a profile (sets the cookie) and reload so all scoped state re-resolves. */
  selectProfile: (userId: string) => Promise<void>;
  /** Create a new profile and return it. */
  createProfile: (name: string, color?: string) => Promise<Profile>;
  /** Clear the active profile (back to the picker). */
  clearProfile: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [meRes, usersRes] = await Promise.all([
      fetch('/api/me').then((r) => r.json() as Promise<{ user: Profile | null }>),
      fetch('/api/users').then((r) => r.json() as Promise<Profile[]>),
    ]);
    setUser(meRes.user);
    setUsers(usersRes);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [refresh]);

  const selectProfile = useCallback(async (userId: string) => {
    await fetch('/api/me/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    // Reload so theme + scoped track lists re-resolve cleanly for the new profile.
    window.location.reload();
  }, []);

  const createProfile = useCallback(async (name: string, color?: string) => {
    const created = (await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color }),
    }).then((r) => r.json())) as Profile;
    setUsers((prev) => [...prev, created]);
    return created;
  }, []);

  const clearProfile = useCallback(async () => {
    await fetch('/api/me/profile/clear', { method: 'POST' });
    window.location.reload();
  }, []);

  return (
    <ProfileContext.Provider
      value={{ user, users, loading, refresh, selectProfile, createProfile, clearProfile }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used within a ProfileProvider');
  return ctx;
}
