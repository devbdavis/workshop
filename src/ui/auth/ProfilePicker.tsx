import { useState, type FormEvent } from 'react';
import { useProfile } from '../hooks/useProfile';

const PRESET_COLORS = ['#3b82f6', '#8b5cf6', '#0891b2', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

/**
 * Shown after the auth gate when no profile is selected. Profiles are identity,
 * not security — they just scope per-user favorites/theme/editor settings.
 */
export function ProfilePicker() {
  const { users, selectProfile, createProfile } = useProfile();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [busy, setBusy] = useState(false);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const created = await createProfile(name.trim(), color);
      await selectProfile(created.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm mx-auto">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8">
          <h1 className="text-xl font-semibold text-gray-100 mb-1">Who's working?</h1>
          <p className="text-sm text-gray-400 mb-6">
            Pick a profile so favorites, theme, and editor settings stay yours.
          </p>

          {!creating && (
            <>
              <div className="space-y-2 mb-4">
                {users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => selectProfile(u.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-left transition-colors"
                  >
                    <span
                      className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-xs font-semibold text-white"
                      style={{ backgroundColor: u.color || '#3b82f6' }}
                    >
                      {u.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-sm text-gray-100">{u.name}</span>
                  </button>
                ))}
                {users.length === 0 && (
                  <p className="text-xs text-gray-500">No profiles yet — create one to get started.</p>
                )}
              </div>
              <button
                onClick={() => setCreating(true)}
                className="w-full py-2 text-sm text-gray-400 hover:text-gray-200 border border-dashed border-gray-700 rounded transition-colors"
              >
                + New profile
              </button>
            </>
          )}

          {creating && (
            <form onSubmit={handleCreate}>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Profile name"
                autoFocus
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-3"
              />
              <div className="flex items-center gap-2 mb-4">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full transition-transform ${color === c ? 'ring-2 ring-white scale-110' : ''}`}
                    style={{ backgroundColor: c }}
                    aria-label={`Pick color ${c}`}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="flex-1 py-2 text-sm text-gray-400 hover:text-gray-200 border border-gray-700 rounded transition-colors"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={busy || !name.trim()}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded transition-colors"
                >
                  {busy ? 'Creating…' : 'Create & continue'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
