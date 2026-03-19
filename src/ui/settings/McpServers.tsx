import { useEffect, useState } from 'react';
import type { McpServerConfig, McpInstallResult } from '@foundation/types';

interface ToolStatus {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
};

export function McpServers() {
  const [configs, setConfigs] = useState<McpServerConfig[]>([]);
  const [toolStatus, setToolStatus] = useState<ToolStatus | null>(null);
  const [importing, setImporting] = useState(false);
  const [installingAll, setInstallingAll] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<McpInstallResult[] | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const [configsRes, statusRes] = await Promise.all([
        fetch('/api/mcp-configs'),
        fetch('/api/mcp-configs/tool-status'),
      ]);
      if (configsRes.ok) setConfigs(await configsRes.json());
      if (statusRes.ok) setToolStatus(await statusRes.json());
    } catch (err) {
      console.error('Failed to load MCP configs:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleImport() {
    setImporting(true);
    setLastResults(null);
    try {
      const res = await fetch('/api/mcp-configs/import-from-claude', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        console.log(`Imported ${data.count} MCP servers from Claude`);
        await load();
      }
    } catch (err) {
      console.error('Import failed:', err);
    } finally {
      setImporting(false);
    }
  }

  async function handleInstallAll(tools: string[]) {
    setInstallingAll(true);
    setLastResults(null);
    try {
      const res = await fetch('/api/mcp-configs/install-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools }),
      });
      if (res.ok) {
        const data = await res.json();
        setLastResults(data.results);
      }
    } catch (err) {
      console.error('Install all failed:', err);
    } finally {
      setInstallingAll(false);
    }
  }

  async function handleInstallOne(id: string, tools: string[]) {
    setInstallingId(id);
    setLastResults(null);
    try {
      const res = await fetch(`/api/mcp-configs/${id}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools }),
      });
      if (res.ok) {
        const results = await res.json();
        setLastResults(results);
      }
    } catch (err) {
      console.error('Install failed:', err);
    } finally {
      setInstallingId(null);
    }
  }

  async function handleToggle(config: McpServerConfig) {
    await fetch(`/api/mcp-configs/${config.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !config.enabled }),
    });
    await load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this MCP server config?')) return;
    await fetch(`/api/mcp-configs/${id}`, { method: 'DELETE' });
    await load();
  }

  if (loading) {
    return <p className="text-sm text-gray-500">Loading MCP servers...</p>;
  }

  const availableTools = toolStatus
    ? (Object.entries(toolStatus).filter(([, v]) => v).map(([k]) => k))
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">MCP Servers</h2>
          <p className="text-sm text-gray-400 mt-1">
            Manage MCP server configs across CLI tools.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleImport}
            disabled={importing}
            className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg transition-colors"
          >
            {importing ? 'Importing...' : 'Import from Claude'}
          </button>
          {configs.length > 0 && availableTools.length > 0 && (
            <button
              onClick={() => handleInstallAll(availableTools)}
              disabled={installingAll}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors"
            >
              {installingAll ? 'Installing...' : 'Install All'}
            </button>
          )}
        </div>
      </div>

      {/* Tool availability badges */}
      {toolStatus && (
        <div className="flex gap-2">
          {Object.entries(toolStatus).map(([tool, available]) => (
            <span
              key={tool}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${
                available
                  ? 'bg-green-900/50 text-green-300'
                  : 'bg-gray-800 text-gray-500'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${available ? 'bg-green-400' : 'bg-gray-600'}`} />
              {TOOL_LABELS[tool] || tool}
            </span>
          ))}
        </div>
      )}

      {/* Install results */}
      {lastResults && <InstallResults results={lastResults} onDismiss={() => setLastResults(null)} />}

      {/* Server list */}
      {configs.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-gray-500 italic">No MCP servers configured.</p>
          <p className="text-xs text-gray-600 mt-1">
            Click "Import from Claude" to pull in your Claude Code MCP servers.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {configs.map((config) => (
            <ServerCard
              key={config.id}
              config={config}
              availableTools={availableTools}
              installing={installingId === config.id}
              onInstall={(tools) => handleInstallOne(config.id, tools)}
              onToggle={() => handleToggle(config)}
              onDelete={() => handleDelete(config.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ServerCard({
  config,
  availableTools,
  installing,
  onInstall,
  onToggle,
  onDelete,
}: {
  config: McpServerConfig;
  availableTools: string[];
  installing: boolean;
  onInstall: (tools: string[]) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const typeColors: Record<string, string> = {
    stdio: 'bg-violet-900/60 text-violet-300',
    http: 'bg-sky-900/60 text-sky-300',
    sse: 'bg-amber-900/60 text-amber-300',
  };

  return (
    <div className={`bg-gray-800 border border-gray-700 rounded-lg p-3 ${!config.enabled ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-200">{config.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${typeColors[config.transportType] || 'bg-gray-700 text-gray-400'}`}>
              {config.transportType}
            </span>
            {config.source === 'claude-import' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">imported</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1 font-mono truncate">
            {config.transportType === 'stdio'
              ? `${config.command || ''} ${(config.args || []).join(' ')}`.trim()
              : config.url || ''}
          </p>
          {config.env && Object.keys(config.env).length > 0 && (
            <p className="text-[10px] text-gray-600 mt-0.5">
              env: {Object.keys(config.env).join(', ')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          <button
            onClick={() => onInstall(availableTools)}
            disabled={installing || !config.enabled || availableTools.length === 0}
            className="text-xs px-2 py-1 rounded bg-green-800 hover:bg-green-700 text-green-200 disabled:opacity-40 transition-colors"
            title="Install in all available CLI tools"
          >
            {installing ? '...' : 'Install'}
          </button>
          <button
            onClick={onToggle}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              config.enabled
                ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                : 'bg-gray-700 text-gray-500 hover:bg-gray-600'
            }`}
          >
            {config.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={onDelete}
            className="text-xs text-red-500 hover:text-red-400"
          >
            &times;
          </button>
        </div>
      </div>
    </div>
  );
}

function InstallResults({ results, onDismiss }: { results: McpInstallResult[]; onDismiss: () => void }) {
  const successes = results.filter((r) => r.success);
  const failures = results.filter((r) => !r.success);

  return (
    <div className="p-3 rounded-lg bg-gray-800 border border-gray-700 text-xs space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-medium text-gray-300">
          Install results: {successes.length} ok, {failures.length} failed
        </span>
        <button onClick={onDismiss} className="text-gray-500 hover:text-gray-300">&times;</button>
      </div>
      {failures.length > 0 && (
        <div className="text-red-400 space-y-0.5">
          {failures.map((f, i) => (
            <p key={i}>{f.tool}/{f.serverName}: {f.message}</p>
          ))}
        </div>
      )}
    </div>
  );
}
