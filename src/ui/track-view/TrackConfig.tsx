import { useState } from 'react';
import type { Track } from '@foundation/types';

interface Props {
  track: Track;
  onUpdate: () => void;
}

export function TrackConfig({ track, onUpdate }: Props) {
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [showAddPath, setShowAddPath] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(track.name);
  const [description, setDescription] = useState(track.description || '');

  async function saveMeta() {
    await fetch(`/api/tracks/${track.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: description || undefined }),
    });
    setEditingName(false);
    onUpdate();
  }

  async function addRepo(path: string, remoteUrl?: string) {
    await fetch(`/api/tracks/${track.id}/repos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, remoteUrl: remoteUrl || undefined }),
    });
    setShowAddRepo(false);
    onUpdate();
  }

  async function removeRepo(repoId: string) {
    await fetch(`/api/tracks/${track.id}/repos/${repoId}`, { method: 'DELETE' });
    onUpdate();
  }

  async function addPath(path: string, label?: string) {
    await fetch(`/api/tracks/${track.id}/paths`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, label: label || undefined }),
    });
    setShowAddPath(false);
    onUpdate();
  }

  async function removePath(pathId: string) {
    await fetch(`/api/tracks/${track.id}/paths/${pathId}`, { method: 'DELETE' });
    onUpdate();
  }

  async function archiveTrack() {
    if (!confirm('Archive this track?')) return;
    await fetch(`/api/tracks/${track.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    });
    window.location.href = '/';
  }

  return (
    <div className="p-4 space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-gray-300 mb-2">Track Details</h3>
        {editingName ? (
          <div className="space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="block w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm"
              autoFocus
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="block w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm resize-none"
              placeholder="Description..."
            />
            <div className="flex gap-2">
              <button onClick={saveMeta} className="text-xs text-blue-400 hover:text-blue-300">
                Save
              </button>
              <button
                onClick={() => setEditingName(false)}
                className="text-xs text-gray-500 hover:text-gray-400"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-400">{track.description || 'No description'}</p>
            <button
              onClick={() => setEditingName(true)}
              className="text-xs text-gray-500 hover:text-gray-400 mt-1"
            >
              Edit
            </button>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-300">Repositories</h3>
          <button
            onClick={() => setShowAddRepo(!showAddRepo)}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            + Add
          </button>
        </div>
        {showAddRepo && <AddRepoForm onAdd={addRepo} onCancel={() => setShowAddRepo(false)} />}
        {track.repos && track.repos.length > 0 ? (
          <ul className="space-y-1">
            {track.repos.map((repo) => (
              <li key={repo.id} className="flex items-center justify-between text-sm group">
                <span className="font-mono text-xs text-gray-400 truncate">{repo.path}</span>
                <button
                  onClick={() => removeRepo(repo.id)}
                  className="text-xs text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-600 italic">No repos linked.</p>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-300">Filesystem Paths</h3>
          <button
            onClick={() => setShowAddPath(!showAddPath)}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            + Add
          </button>
        </div>
        {showAddPath && <AddPathForm onAdd={addPath} onCancel={() => setShowAddPath(false)} />}
        {track.paths && track.paths.length > 0 ? (
          <ul className="space-y-1">
            {track.paths.map((p) => (
              <li key={p.id} className="flex items-center justify-between text-sm group">
                <span className="font-mono text-xs text-gray-400 truncate">
                  {p.label && <span className="text-gray-500 mr-1">{p.label}:</span>}
                  {p.path}
                </span>
                <button
                  onClick={() => removePath(p.id)}
                  className="text-xs text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-600 italic">No paths tracked.</p>
        )}
      </section>

      <section className="pt-4 border-t border-gray-800">
        <button onClick={archiveTrack} className="text-xs text-red-500 hover:text-red-400">
          Archive Track
        </button>
      </section>
    </div>
  );
}

function AddRepoForm({
  onAdd,
  onCancel,
}: {
  onAdd: (path: string, remoteUrl?: string) => void;
  onCancel: () => void;
}) {
  const [path, setPath] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');

  return (
    <div className="mb-3 space-y-2 p-2 bg-gray-800/50 rounded">
      <input
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="/path/to/repo"
        className="block w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs font-mono"
        autoFocus
      />
      <input
        value={remoteUrl}
        onChange={(e) => setRemoteUrl(e.target.value)}
        placeholder="Remote URL (optional)"
        className="block w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs"
      />
      <div className="flex gap-2">
        <button
          onClick={() => path.trim() && onAdd(path.trim(), remoteUrl.trim() || undefined)}
          className="text-xs text-blue-400"
        >
          Add
        </button>
        <button onClick={onCancel} className="text-xs text-gray-500">
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddPathForm({
  onAdd,
  onCancel,
}: {
  onAdd: (path: string, label?: string) => void;
  onCancel: () => void;
}) {
  const [path, setPath] = useState('');
  const [label, setLabel] = useState('');

  return (
    <div className="mb-3 space-y-2 p-2 bg-gray-800/50 rounded">
      <input
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="/path/to/directory"
        className="block w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs font-mono"
        autoFocus
      />
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label (optional)"
        className="block w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs"
      />
      <div className="flex gap-2">
        <button
          onClick={() => path.trim() && onAdd(path.trim(), label.trim() || undefined)}
          className="text-xs text-blue-400"
        >
          Add
        </button>
        <button onClick={onCancel} className="text-xs text-gray-500">
          Cancel
        </button>
      </div>
    </div>
  );
}
