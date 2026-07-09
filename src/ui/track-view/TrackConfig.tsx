import { useState, useEffect } from 'react';
import type { Agent, PromptTemplate, Track } from '@foundation/types';

interface GlobalRepo {
  id: string;
  path: string;
  name: string;
  mainBranch: 'main' | 'master';
}

function tildeify(p: string): string {
  const homePattern = /^\/(?:Users|home)\/[^/]+/;
  const match = p.match(homePattern);
  if (match) return '~' + p.slice(match[0].length);
  return p;
}

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
  const [agents, setAgents] = useState<Agent[]>([]);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);

  useEffect(() => {
    fetch('/api/agents')
      .then((r) => (r.ok ? r.json() : []))
      .then(setAgents)
      .catch(() => setAgents([]));
    fetch('/api/templates')
      .then((r) => (r.ok ? r.json() : []))
      .then(setTemplates)
      .catch(() => setTemplates([]));
  }, []);

  async function setDefaultTemplate(templateId: string | null) {
    await fetch(`/api/tracks/${track.id}/prompt`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId }),
    });
    onUpdate();
  }

  async function setDefaultAgent(agentId: string | null) {
    await fetch(`/api/tracks/${track.id}/agent`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    });
    onUpdate();
  }

  async function saveMeta() {
    await fetch(`/api/tracks/${track.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: description.trim() }),
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
        {showAddRepo && <AddRepoForm onAdd={(p) => addRepo(p)} onCancel={() => setShowAddRepo(false)} />}
        {track.repos && track.repos.length > 0 ? (
          <ul className="space-y-1">
            {track.repos.map((repo) => (
              <li key={repo.id} className="flex items-center justify-between text-sm group">
                <span className="font-mono text-xs text-gray-400 truncate">{tildeify(repo.path)}</span>
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

      <section>
        <h3 className="text-sm font-semibold text-gray-300 mb-2">Agent Behaviour</h3>

        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">Default agent</label>
          <select
            value={track.defaultAgentId ?? ''}
            onChange={(e) => setDefaultAgent(e.target.value || null)}
            className="block w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300"
          >
            <option value="">None</option>
            {[...agents].sort((a, b) => a.name.localeCompare(b.name)).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <p className="text-[10px] text-gray-600 mt-1">
            Used when dispatching todos without an explicit agent selection.
          </p>
        </div>

        <div className="mb-3">
          <label className="block text-xs text-gray-400 mb-1">Prompt template</label>
          <select
            value={track.defaultPromptTemplateId ?? ''}
            onChange={(e) => setDefaultTemplate(e.target.value || null)}
            className="block w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300"
          >
            {[...templates].sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <p className="text-[10px] text-gray-600 mt-1">
            Injected into the system prompt when dispatching todos. Manage templates in Settings → Prompt Templates.
          </p>
        </div>

        <label className="flex items-center gap-2 cursor-pointer group">
          <input
            type="checkbox"
            checked={track.worktreeMode ?? false}
            onChange={async (e) => {
              await fetch(`/api/tracks/${track.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ worktreeMode: e.target.checked }),
              });
              onUpdate();
            }}
            className="rounded border-gray-600 bg-gray-800 w-3 h-3"
          />
          <span className="text-xs text-gray-400 group-hover:text-gray-200">
            Worktree mode
          </span>
        </label>
        <p className="text-[10px] text-gray-600 mt-1">
          Each background session gets isolated git worktrees of linked repos.
        </p>
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
  onAdd: (path: string) => void;
  onCancel: () => void;
}) {
  const [globalRepos, setGlobalRepos] = useState<GlobalRepo[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [customPath, setCustomPath] = useState('');

  useEffect(() => {
    fetch('/api/repos')
      .then((r) => r.ok ? r.json() : [])
      .then(setGlobalRepos)
      .catch(() => setGlobalRepos([]));
  }, []);

  function submit() {
    if (selectedId) {
      const repo = globalRepos.find((r) => r.id === selectedId);
      if (repo) { onAdd(repo.path); return; }
    }
    if (customPath.trim()) {
      onAdd(customPath.trim());
    }
  }

  return (
    <div className="mb-3 space-y-2 p-2 bg-gray-800/50 rounded">
      {globalRepos.length > 0 && (
        <select
          value={selectedId}
          onChange={(e) => { setSelectedId(e.target.value); if (e.target.value) setCustomPath(''); }}
          className="block w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs font-mono"
        >
          <option value="">-- Select a global repo --</option>
          {globalRepos.map((r) => (
            <option key={r.id} value={r.id}>{tildeify(r.path)}</option>
          ))}
        </select>
      )}
      <input
        value={customPath}
        onChange={(e) => { setCustomPath(e.target.value); if (e.target.value) setSelectedId(''); }}
        placeholder="/path/to/repo (new path)"
        className="block w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs font-mono"
        autoFocus={globalRepos.length === 0}
      />
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={!selectedId && !customPath.trim()}
          className="text-xs text-blue-400 disabled:opacity-40"
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
