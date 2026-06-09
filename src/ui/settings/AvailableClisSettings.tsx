import { useState } from 'react';
import { TerminalModal } from '../track-view/TerminalModal';
import { useAvailableClis, type CliInfo, type ClisResponse } from '../hooks/useAvailableClis';

interface AuthTarget {
  authId: string;
  label: string;
}

function InstalledBadge({ installed }: { installed: boolean }) {
  return installed ? (
    <span className="text-[11px] text-emerald-400">installed</span>
  ) : (
    <span className="text-[11px] text-gray-500">not found</span>
  );
}

export function AvailableClisSettings() {
  const { clis, available, loading, refresh, setData } = useAvailableClis();
  const [auth, setAuth] = useState<AuthTarget | null>(null);

  const agents = clis.filter((c) => c.kind === 'agent');
  const tools = clis.filter((c) => c.kind === 'tool');

  async function toggleAgent(cli: CliInfo, next: boolean): Promise<void> {
    const enabledIds = agents.filter((a) => a.enabled).map((a) => a.id);
    const nextIds = next
      ? Array.from(new Set([...enabledIds, cli.id]))
      : enabledIds.filter((id) => id !== cli.id);
    try {
      const res = await fetch('/api/settings/available-clis', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ available: nextIds }),
      });
      if (res.ok) {
        setData((await res.json()) as ClisResponse);
      }
    } catch {
      await refresh();
    }
  }

  async function authenticate(cli: CliInfo): Promise<void> {
    try {
      const res = await fetch(`/api/auth/cli/${cli.id}`, { method: 'POST' });
      if (!res.ok) return;
      const { authId } = (await res.json()) as { authId: string };
      setAuth({ authId, label: cli.label });
    } catch {
      /* ignore */
    }
  }

  function closeAuth(): void {
    if (auth) {
      // Fire-and-forget teardown of the auth tmux session.
      void fetch(`/api/auth/cli/${auth.authId}`, { method: 'DELETE' });
    }
    setAuth(null);
    void refresh();
  }

  if (loading) {
    return <p className="text-xs text-gray-500">Loading…</p>;
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-200 mb-1">Available CLIs &amp; Tool Auth</h2>
      <p className="text-xs text-gray-500 mb-5">
        Choose which AI CLIs are offered when starting sessions, and authenticate any CLI or tool
        through an interactive terminal popup. Disabled agents are hidden from the New Session and
        Default AI CLI menus. The auth terminal keeps a live shell open, so you can re-run or
        correct a login command if needed.
      </p>

      <div className="space-y-6">
        {/* AI CLIs */}
        <div>
          <h3 className="text-xs font-semibold text-gray-300 mb-2">AI CLIs</h3>
          <ul className="space-y-2">
            {agents.map((cli) => (
              <li key={cli.id} className="flex items-center gap-3">
                <input
                  id={`cli-${cli.id}`}
                  type="checkbox"
                  checked={cli.enabled}
                  onChange={(e) => toggleAgent(cli, e.target.checked)}
                  className="h-4 w-4 rounded border-gray-700 bg-gray-800"
                />
                <label htmlFor={`cli-${cli.id}`} className="text-xs text-gray-300 w-40">
                  {cli.label}
                </label>
                <InstalledBadge installed={cli.installed} />
                <button
                  onClick={() => authenticate(cli)}
                  disabled={!cli.installed}
                  title={cli.installed ? `Authenticate ${cli.label}` : `${cli.label} not installed`}
                  className="ml-auto px-3 py-1 text-[11px] bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 rounded transition-colors text-gray-100"
                >
                  Authenticate
                </button>
              </li>
            ))}
          </ul>
          {available.length === 0 && (
            <p className="text-[11px] text-amber-400 mt-2">
              No agents enabled — Claude will be used as a fallback.
            </p>
          )}
        </div>

        {/* Tools */}
        <div className="pt-4 border-t border-gray-800">
          <h3 className="text-xs font-semibold text-gray-300 mb-2">Tools</h3>
          <ul className="space-y-2">
            {tools.map((cli) => (
              <li key={cli.id} className="flex items-center gap-3">
                <span className="text-xs text-gray-300 w-40">{cli.label}</span>
                <InstalledBadge installed={cli.installed} />
                <button
                  onClick={() => authenticate(cli)}
                  disabled={!cli.installed}
                  title={cli.installed ? `Authenticate ${cli.label}` : `${cli.label} not installed`}
                  className="ml-auto px-3 py-1 text-[11px] bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 rounded transition-colors text-gray-100"
                >
                  Authenticate
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {auth && (
        <TerminalModal
          wsPath={`/ws/auth/${auth.authId}/terminal`}
          title={`Authenticate: ${auth.label}`}
          onClose={closeAuth}
        />
      )}
    </div>
  );
}
