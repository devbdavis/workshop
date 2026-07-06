import { useEffect, useState } from 'react';
import type { Plugin, PluginSyncResult } from '@foundation/types';

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  gemini: 'Gemini',
  codex: 'Codex',
  cursor: 'Cursor',
};

export function Plugins() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastResults, setLastResults] = useState<PluginSyncResult[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newRepo, setNewRepo] = useState('');
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/plugins');
      if (res.ok) setPlugins(await res.json());
    } catch (err) {
      console.error('Failed to load plugins:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSync() {
    setSyncing(true);
    setLastResults(null);
    try {
      const res = await fetch('/api/plugins/sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setLastResults(data.results);
        await load();
      }
    } catch (err) {
      console.error('Plugin sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }

  async function handleAdd() {
    setAddError(null);
    const res = await fetch('/api/plugins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketplaceRepo: newRepo.trim(), pluginName: newName.trim() }),
    });
    if (res.ok) {
      setNewRepo('');
      setNewName('');
      setShowAdd(false);
      await load();
    } else {
      const data = await res.json().catch(() => ({}));
      setAddError(data.error || 'Failed to add plugin');
    }
  }

  async function handleToggle(plugin: Plugin) {
    await fetch(`/api/plugins/${plugin.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !plugin.enabled }),
    });
    await load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this plugin from the registry? (Does not uninstall it from CLI tools.)')) return;
    await fetch(`/api/plugins/${id}`, { method: 'DELETE' });
    await load();
  }

  if (loading) {
    return <p className="text-sm text-gray-500">Loading plugins...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Marketplace Plugins</h2>
          <p className="text-sm text-gray-400 mt-1">
            Default AI-CLI plugins available in all Workshop sessions. Installs are user-global;
            disabling a plugin here turns it off in Workshop-spawned Claude sessions and removes
            Codex/Gemini artifacts at next sync.
          </p>
        </div>
        <div className="flex gap-2 shrink-0 ml-4">
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            {showAdd ? 'Cancel' : 'Add Plugin'}
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
          >
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-2">
          <div className="flex gap-2">
            <input
              value={newRepo}
              onChange={(e) => setNewRepo(e.target.value)}
              placeholder="Marketplace repo (owner/repo)"
              className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
            />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Plugin name (name@marketplace)"
              className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-sm"
            />
            <button
              onClick={handleAdd}
              disabled={!newRepo.trim() || !newName.trim()}
              className="px-3 py-1.5 text-sm bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded-lg transition-colors"
            >
              Add
            </button>
          </div>
          {addError && <p className="text-xs text-red-400">{addError}</p>}
        </div>
      )}

      {lastResults && <SyncResults results={lastResults} onDismiss={() => setLastResults(null)} />}

      {plugins.length === 0 ? (
        <p className="text-sm text-gray-500 italic text-center py-8">No plugins registered.</p>
      ) : (
        <div className="space-y-2">
          {plugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              onToggle={() => handleToggle(plugin)}
              onDelete={() => handleDelete(plugin.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PluginCard({ plugin, onToggle, onDelete }: { plugin: Plugin; onToggle: () => void; onDelete: () => void }) {
  const providers = plugin.providers ?? {};
  return (
    <div className={`bg-gray-800 border border-gray-700 rounded-lg p-3 ${!plugin.enabled ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-200">{plugin.pluginName}</span>
            {Object.entries(PROVIDER_LABELS).map(([key, label]) => {
              const supported = providers[key as keyof typeof providers];
              if (supported === undefined) return null;
              return (
                <span
                  key={key}
                  className={`text-[10px] px-1.5 py-0.5 rounded ${
                    supported ? 'bg-green-900/60 text-green-300' : 'bg-gray-700 text-gray-500 line-through'
                  }`}
                  title={supported ? `Reaches ${label}` : `${label} not supported by this plugin repo`}
                >
                  {label}
                </span>
              );
            })}
            {plugin.providers === undefined && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400" title="Run Sync Now to detect provider coverage">
                not yet synced
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1 font-mono truncate">{plugin.marketplaceRepo}</p>
          {plugin.description && <p className="text-xs text-gray-500 mt-0.5">{plugin.description}</p>}
        </div>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          <button
            onClick={onToggle}
            className="text-xs px-2 py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
          >
            {plugin.enabled ? 'Disable' : 'Enable'}
          </button>
          <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-400">&times;</button>
        </div>
      </div>
    </div>
  );
}

function SyncResults({ results, onDismiss }: { results: PluginSyncResult[]; onDismiss: () => void }) {
  const failures = results.filter((r) => !r.success);
  return (
    <div className="p-3 rounded-lg bg-gray-800 border border-gray-700 text-xs space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-medium text-gray-300">
          Sync results: {results.length - failures.length} ok, {failures.length} failed
        </span>
        <button onClick={onDismiss} className="text-gray-500 hover:text-gray-300">&times;</button>
      </div>
      {failures.length > 0 && (
        <div className="text-red-400 space-y-0.5">
          {failures.map((f, i) => (
            <p key={i}>{f.provider}/{f.pluginName}: {f.message}</p>
          ))}
        </div>
      )}
    </div>
  );
}
