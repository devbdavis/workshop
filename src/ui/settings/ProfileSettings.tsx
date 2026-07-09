import { useEffect, useState } from 'react';
import { useProfile } from '../hooks/useProfile';
import {
  EDITOR_URI_PREFIX_KEY,
  EDITOR_PATH_FROM_KEY,
  EDITOR_PATH_TO_KEY,
} from '../hooks/useEditorLaunch';

const PREFIX_SAMPLES = [
  { label: 'VSCode Remote-SSH', value: 'vscode://vscode-remote/ssh-remote+<your-ssh-host>' },
  { label: 'Local VSCode', value: 'vscode://file' },
  { label: 'Cursor Remote-SSH', value: 'cursor://anysphere.remote-ssh/ssh-remote+<your-ssh-host>' },
];

/**
 * Profile identity + per-user editor-launch settings. The host runs in Docker, so
 * "Open in Editor" hands a URI to the user's local editor (VSCode Remote-SSH). Each
 * user supplies their own URI prefix; Workshop appends the (optionally remapped) path.
 */
export function ProfileSettings() {
  const { user, users, selectProfile, clearProfile, refresh } = useProfile();

  const [name, setName] = useState(user?.name ?? '');
  const [prefix, setPrefix] = useState('');
  const [pathFrom, setPathFrom] = useState('');
  const [pathTo, setPathTo] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me/settings')
      .then((r) => r.json() as Promise<Record<string, string>>)
      .then((s) => {
        setPrefix(s[EDITOR_URI_PREFIX_KEY] ?? '');
        setPathFrom(s[EDITOR_PATH_FROM_KEY] ?? '');
        setPathTo(s[EDITOR_PATH_TO_KEY] ?? '');
      })
      .catch(() => {});
  }, []);

  async function setSetting(key: string, value: string) {
    await fetch(`/api/me/settings/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
  }

  async function saveEditor() {
    await Promise.all([
      setSetting(EDITOR_URI_PREFIX_KEY, prefix.trim()),
      setSetting(EDITOR_PATH_FROM_KEY, pathFrom.trim()),
      setSetting(EDITOR_PATH_TO_KEY, pathTo.trim()),
    ]);
    setSavedAt(new Date().toLocaleTimeString());
  }

  async function saveName() {
    if (!user || !name.trim() || name.trim() === user.name) return;
    await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    await refresh();
  }

  return (
    <div className="space-y-6">
      {/* Identity */}
      <div>
        <h2 className="text-sm font-semibold text-gray-200 mb-1">Profile</h2>
        <p className="text-xs text-gray-500 mb-3">
          Profiles scope favorites, theme, and editor settings per person. They are
          identity, not security — the shared auth token still gates access.
        </p>
        <div className="flex items-center gap-2 mb-3">
          <span
            className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-semibold text-white"
            style={{ backgroundColor: user?.color || '#3b82f6' }}
          >
            {(user?.name ?? '?').charAt(0).toUpperCase()}
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={user?.id ?? ''}
            onChange={(e) => e.target.value && selectProfile(e.target.value)}
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-100"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <button
            onClick={clearProfile}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 border border-gray-700 rounded"
          >
            Switch profile…
          </button>
        </div>
      </div>

      {/* Editor launch */}
      <div className="border-t border-gray-800 pt-5">
        <h2 className="text-sm font-semibold text-gray-200 mb-1">Open in Editor</h2>
        <p className="text-xs text-gray-500 mb-3">
          The button builds <code className="text-gray-400">prefix + path</code> and opens it
          in your editor. Leave the prefix blank to launch on the host (only useful for
          non-Docker installs).
        </p>

        <label className="block text-xs text-gray-400 mb-1">Editor URI prefix</label>
        <input
          value={prefix}
          onChange={(e) => setPrefix(e.target.value)}
          placeholder="vscode://vscode-remote/ssh-remote+myhost"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500 mb-2"
        />
        <div className="flex flex-wrap gap-1.5 mb-4">
          {PREFIX_SAMPLES.map((s) => (
            <button
              key={s.label}
              onClick={() => setPrefix(s.value)}
              className="px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200 bg-gray-800 border border-gray-700 rounded"
              title={s.value}
            >
              {s.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-500 mb-2">
          Optional path remap — only needed when your SSH-side path differs from the
          container path (e.g. SSH into the host where <code className="text-gray-400">/repos</code>
          is mounted elsewhere). Leave blank if you SSH into the container.
        </p>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Container path prefix</label>
            <input
              value={pathFrom}
              onChange={(e) => setPathFrom(e.target.value)}
              placeholder="/repos"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Editor-side path prefix</label>
            <input
              value={pathTo}
              onChange={(e) => setPathTo(e.target.value)}
              placeholder="/mnt/user/repos"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-100 font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={saveEditor}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded"
          >
            Save editor settings
          </button>
          {savedAt && <span className="text-xs text-gray-500">Saved {savedAt}</span>}
        </div>
      </div>
    </div>
  );
}
