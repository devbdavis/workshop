import { useEffect, useState } from 'react';

interface GlobalRepo {
  id: string;
  path: string;
  name: string;
  mainBranch: 'main' | 'master';
  createdAt: string;
  updatedAt: string;
}

function tildeify(p: string): string {
  const match = p.match(/^\/(?:Users|home)\/[^/]+/);
  if (match) return '~' + p.slice(match[0].length);
  return p;
}

export function Repositories() {
  const [repos, setRepos] = useState<GlobalRepo[]>([]);
  const [repoRoot, setRepoRoot] = useState('~/Klaviyo/Repos');
  const [editingRoot, setEditingRoot] = useState(false);
  const [rootDraft, setRootDraft] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [addError, setAddError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const [reposRes, rootRes] = await Promise.all([
        fetch('/api/repos'),
        fetch('/api/settings/repo-root'),
      ]);
      if (reposRes.ok) setRepos(await reposRes.json());
      if (rootRes.ok) {
        const data = await rootRes.json();
        setRepoRoot(data.value);
      }
    } catch (err) {
      console.error('Failed to load repos:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadSuggestions() {
    try {
      const res = await fetch('/api/repos/suggestions');
      if (res.ok) setSuggestions(await res.json());
    } catch {
      setSuggestions([]);
    }
  }

  useEffect(() => { load(); }, []);

  async function saveRepoRoot() {
    await fetch('/api/settings/repo-root', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: rootDraft }),
    });
    setRepoRoot(rootDraft);
    setEditingRoot(false);
  }

  async function addRepo(repoPath: string) {
    setAddError('');
    const res = await fetch('/api/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: repoPath }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.repo) {
        // Already exists — still close and refresh
        setShowAdd(false);
        setNewPath('');
        await load();
        return;
      }
      setAddError(body.error || 'Failed to add repo');
      return;
    }
    setShowAdd(false);
    setNewPath('');
    await load();
  }

  async function deleteRepo(id: string) {
    if (!confirm('Remove this repo from the global registry?')) return;
    await fetch(`/api/repos/${id}`, { method: 'DELETE' });
    await load();
  }

  function openAdd() {
    setShowAdd(true);
    setAddError('');
    setNewPath('');
    loadSuggestions();
  }

  if (loading) {
    return <p className="text-xs text-gray-500">Loading repositories...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200">Repositories</h2>
        <button
          onClick={openAdd}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          + Add Repo
        </button>
      </div>

      {/* Repo root config */}
      <div className="space-y-1">
        <p className="text-xs text-gray-500">Repo root (used for suggestions)</p>
        {editingRoot ? (
          <div className="flex gap-2 items-center">
            <input
              value={rootDraft}
              onChange={(e) => setRootDraft(e.target.value)}
              className="flex-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs font-mono"
              autoFocus
            />
            <button onClick={saveRepoRoot} className="text-xs text-blue-400 hover:text-blue-300">
              Save
            </button>
            <button onClick={() => setEditingRoot(false)} className="text-xs text-gray-500">
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex gap-2 items-center">
            <span className="font-mono text-xs text-gray-400">{repoRoot}</span>
            <button
              onClick={() => { setRootDraft(repoRoot); setEditingRoot(true); }}
              className="text-xs text-gray-600 hover:text-gray-400"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {/* Add repo form */}
      {showAdd && (
        <div className="p-3 bg-gray-800/50 rounded space-y-2">
          <p className="text-xs text-gray-400">Enter an absolute path or choose a subfolder of the repo root:</p>
          {suggestions.length > 0 && (
            <select
              className="block w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs font-mono"
              onChange={(e) => {
                if (e.target.value) {
                  // Construct full path from repo root + suggestion
                  const expanded = repoRoot.startsWith('~/')
                    ? repoRoot.replace(/^~/, '')
                    : repoRoot;
                  setNewPath(`${repoRoot}/${e.target.value}`);
                }
              }}
              defaultValue=""
            >
              <option value="">-- Select a subfolder --</option>
              {suggestions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
          <input
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            placeholder="/absolute/path/to/repo"
            className="block w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs font-mono"
          />
          {addError && <p className="text-xs text-red-400">{addError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => newPath.trim() && addRepo(newPath.trim())}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              Add
            </button>
            <button
              onClick={() => { setShowAdd(false); setAddError(''); }}
              className="text-xs text-gray-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Repo list */}
      {repos.length === 0 ? (
        <p className="text-xs text-gray-600 italic">No global repos registered.</p>
      ) : (
        <ul className="space-y-1">
          {repos.map((repo) => (
            <li key={repo.id} className="flex items-center justify-between group">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-xs text-gray-400 truncate">{tildeify(repo.path)}</span>
                <span className="text-[10px] text-gray-600 shrink-0">{repo.mainBranch}</span>
              </div>
              <button
                onClick={() => deleteRepo(repo.id)}
                className="text-xs text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 shrink-0 ml-2"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
