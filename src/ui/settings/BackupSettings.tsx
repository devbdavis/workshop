import { useState, useEffect } from 'react';

interface RecentBackup {
  fileName: string;
  kind: string;
  timestamp: string;
}

interface BackupConfig {
  enabled: boolean;
  destination: string;
  cronExpression: string;
  passphraseConfigured: boolean;
  lastStatus: string | null;
  lastCompletedAt: string | null;
  lastStartedAt: string | null;
  lastError: string | null;
  lastFile: string | null;
  lastBytes: number | null;
  recentBackups: RecentBackup[];
}

interface SavePayload {
  enabled?: boolean;
  destination?: string;
  cronExpression?: string;
  passphrase?: string;
}

interface RunResponse {
  ok: boolean;
  filePath?: string;
  kind?: string;
  bytes?: number;
  uncompressedBytes?: number;
  ratio?: number;
  durationMs?: number;
  pruned?: number;
  error?: string;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function BackupSettings() {
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [passphrase, setPassphrase] = useState('');
  const [saved, setSaved] = useState(false);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function load(): Promise<void> {
    const res = await fetch('/api/settings/backup');
    if (res.ok) {
      const data = (await res.json()) as BackupConfig;
      setConfig(data);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave(): Promise<void> {
    if (!config) return;
    const payload: SavePayload = {
      enabled: config.enabled,
      destination: config.destination,
      cronExpression: config.cronExpression,
    };
    if (passphrase.length > 0) {
      payload.passphrase = passphrase;
    }
    const res = await fetch('/api/settings/backup', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setPassphrase('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await load();
    }
  }

  async function handleRunNow(): Promise<void> {
    setRunning(true);
    setRunStatus(null);
    try {
      const res = await fetch('/api/settings/backup/run', { method: 'POST' });
      const data = (await res.json()) as RunResponse;
      if (data.ok) {
        const ratio = data.ratio != null ? `${(data.ratio * 100).toFixed(1)}%` : '—';
        setRunStatus(
          `Backup ${data.kind}: ${formatBytes(data.bytes ?? 0)} (${ratio} of source) in ${((data.durationMs ?? 0) / 1000).toFixed(1)}s`,
        );
        await load();
      } else {
        setRunStatus(`Failed: ${data.error ?? 'Unknown error'}`);
      }
    } catch (err) {
      setRunStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  }

  async function handleClearPassphrase(): Promise<void> {
    const res = await fetch('/api/settings/backup', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase: '' } as SavePayload),
    });
    if (res.ok) {
      setPassphrase('');
      await load();
    }
  }

  if (loading || !config) {
    return <p className="text-xs text-gray-500">Loading…</p>;
  }

  const canRun = config.passphraseConfigured && config.destination.length > 0;

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-200 mb-1">Encrypted Backups</h2>
      <p className="text-xs text-gray-500 mb-5">
        Daily AES-256-GCM encrypted snapshot of the Workshop database and your Claude Code config
        (settings.json, settings.local.json, hooks-config.toml), compressed with brotli. Retention:
        3 dailies + 4 weeklies (Sundays).
      </p>

      <div className="space-y-5">
        {/* Enable toggle */}
        <div className="flex items-center gap-3">
          <input
            id="backup-enabled"
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            className="h-4 w-4 rounded border-gray-700 bg-gray-800"
          />
          <label htmlFor="backup-enabled" className="text-xs text-gray-300">
            Enable scheduled backups
          </label>
        </div>

        {/* Destination */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Destination directory</label>
          <input
            type="text"
            value={config.destination}
            onChange={(e) => setConfig({ ...config, destination: e.target.value })}
            placeholder="/Users/you/Library/CloudStorage/GoogleDrive-.../My Drive/Backups/Workshop"
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 w-full font-mono"
          />
          <p className="text-[11px] text-gray-500 mt-2">
            Point this at a cloud-synced folder (Google Drive, iCloud, Dropbox). The folder is created
            on first run. Supports <span className="font-mono">~/</span> expansion.
          </p>
        </div>

        {/* Cron schedule */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Cron schedule</label>
          <input
            type="text"
            value={config.cronExpression}
            onChange={(e) => setConfig({ ...config, cronExpression: e.target.value })}
            placeholder="0 3 * * *"
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 w-48 font-mono"
          />
          <p className="text-[11px] text-gray-500 mt-2">
            Default: <span className="font-mono">0 3 * * *</span> (03:00 local, daily). Sunday runs
            are tagged as weekly for the longer retention window.
          </p>
        </div>

        {/* Passphrase */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">
            Passphrase{' '}
            {config.passphraseConfigured && (
              <span className="text-emerald-400 text-[11px] ml-1">• configured</span>
            )}
          </label>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder={
              config.passphraseConfigured
                ? '•••••••••••••••••• (leave blank to keep existing)'
                : 'Choose a strong passphrase'
            }
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 w-96 font-mono"
          />
          <p className="text-[11px] text-gray-500 mt-2">
            Used to derive the encryption key (scrypt → AES-256-GCM). <strong className="text-amber-400">Write it
            down somewhere safe</strong> — lost passphrase means unreadable backups.
          </p>
          {config.passphraseConfigured && (
            <button
              onClick={handleClearPassphrase}
              className="mt-2 text-[11px] text-red-400 hover:text-red-300"
            >
              Clear stored passphrase
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 rounded transition-colors text-white"
          >
            {saved ? 'Saved ✓' : 'Save'}
          </button>
          <button
            onClick={handleRunNow}
            disabled={!canRun || running}
            className="px-4 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 rounded transition-colors text-gray-100"
          >
            {running ? 'Running…' : 'Run backup now'}
          </button>
        </div>

        {runStatus && (
          <p className="text-[11px] text-gray-400 bg-gray-800 border border-gray-700 rounded px-3 py-2 font-mono">
            {runStatus}
          </p>
        )}

        {/* Status */}
        <div className="mt-4 pt-4 border-t border-gray-800">
          <h3 className="text-xs font-semibold text-gray-300 mb-2">Last run</h3>
          <dl className="text-[11px] text-gray-400 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            <dt className="text-gray-500">Status</dt>
            <dd>
              {config.lastStatus === 'ok' && <span className="text-emerald-400">OK</span>}
              {config.lastStatus === 'error' && <span className="text-red-400">Error</span>}
              {!config.lastStatus && '—'}
            </dd>
            <dt className="text-gray-500">Completed</dt>
            <dd>{formatTimestamp(config.lastCompletedAt)}</dd>
            <dt className="text-gray-500">Size</dt>
            <dd>{formatBytes(config.lastBytes)}</dd>
            {config.lastFile && (
              <>
                <dt className="text-gray-500">File</dt>
                <dd className="font-mono truncate">{config.lastFile}</dd>
              </>
            )}
            {config.lastError && (
              <>
                <dt className="text-gray-500">Error</dt>
                <dd className="text-red-400">{config.lastError}</dd>
              </>
            )}
          </dl>
        </div>

        {/* Recent backups */}
        {config.recentBackups.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-800">
            <h3 className="text-xs font-semibold text-gray-300 mb-2">
              Recent backups ({config.recentBackups.length})
            </h3>
            <ul className="space-y-1 text-[11px] text-gray-400 font-mono">
              {config.recentBackups.map((b) => (
                <li key={b.fileName} className="flex items-center gap-2">
                  <span
                    className={`inline-block w-12 text-[10px] uppercase tracking-wider ${
                      b.kind === 'weekly' ? 'text-purple-400' : 'text-blue-400'
                    }`}
                  >
                    {b.kind}
                  </span>
                  <span className="truncate">{b.fileName}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
