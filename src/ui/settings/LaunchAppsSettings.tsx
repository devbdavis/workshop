import { useEffect, useState } from 'react';
import {
  invalidateLaunchAppsCache,
  type EditorChoice,
  type LaunchAppsConfig,
  type TerminalChoice,
} from '@ui/hooks/useLaunchApps';

const PLATFORM_LABEL: Record<LaunchAppsConfig['availability']['platform'], string> = {
  darwin: 'macOS',
  linux: 'Linux',
  wsl: 'WSL',
  unknown: 'Unknown',
};

const RESOLVED_EDITOR_LABEL: Record<NonNullable<LaunchAppsConfig['resolvedEditor']>, string> = {
  cursor: 'Cursor',
  code: 'VSCode',
};

const RESOLVED_TERMINAL_LABEL: Record<NonNullable<LaunchAppsConfig['resolvedTerminal']>, string> = {
  iterm: 'iTerm',
  konsole: 'Konsole',
  'gnome-terminal': 'GNOME Terminal',
  wt: 'Windows Terminal',
};

export function LaunchAppsSettings() {
  const [config, setConfig] = useState<LaunchAppsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState<'editor' | 'terminal' | null>(null);

  async function load(): Promise<void> {
    try {
      const res = await fetch('/api/settings/launch-apps');
      if (res.ok) {
        const data = (await res.json()) as LaunchAppsConfig;
        setConfig(data);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveEditor(next: EditorChoice): Promise<void> {
    if (!config) return;
    setConfig({ ...config, editor: next });
    const res = await fetch('/api/settings/launch-apps', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ editor: next }),
    });
    if (res.ok) {
      const data = (await res.json()) as LaunchAppsConfig;
      setConfig(data);
      invalidateLaunchAppsCache();
      setSaved('editor');
      setTimeout(() => setSaved(null), 1500);
    }
  }

  async function saveTerminal(next: TerminalChoice): Promise<void> {
    if (!config) return;
    setConfig({ ...config, terminal: next });
    const res = await fetch('/api/settings/launch-apps', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ terminal: next }),
    });
    if (res.ok) {
      const data = (await res.json()) as LaunchAppsConfig;
      setConfig(data);
      invalidateLaunchAppsCache();
      setSaved('terminal');
      setTimeout(() => setSaved(null), 1500);
    }
  }

  if (loading || !config) {
    return <p className="text-xs text-gray-500">Loading…</p>;
  }

  const { availability } = config;

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-200 mb-1">Editor &amp; Terminal Launchers</h2>
      <p className="text-xs text-gray-500 mb-5">
        Controls which app the &ldquo;Open in editor&rdquo; and &ldquo;Open in terminal&rdquo; buttons launch.
        Detected host: <span className="text-gray-300">{PLATFORM_LABEL[availability.platform]}</span>.
      </p>

      <div className="space-y-5">
        {/* Editor */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">
            Editor
            {saved === 'editor' && <span className="text-emerald-400 text-[11px] ml-2">Saved ✓</span>}
          </label>
          <select
            value={config.editor}
            onChange={(e) => saveEditor(e.target.value as EditorChoice)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 w-72"
          >
            <option value="auto">
              Auto-detect
              {config.resolvedEditor
                ? ` (→ ${RESOLVED_EDITOR_LABEL[config.resolvedEditor]})`
                : ' (none found)'}
            </option>
            <option value="cursor" disabled={!availability.editors.cursor}>
              Cursor{availability.editors.cursor ? '' : ' (not installed)'}
            </option>
            <option value="code" disabled={!availability.editors.code}>
              VSCode{availability.editors.code ? '' : ' (not installed)'}
            </option>
          </select>
          <p className="text-[11px] text-gray-500 mt-2">
            Opens the session&rsquo;s workspace folder (or <span className="font-mono">workspace.code-workspace</span>{' '}
            if present). Both Cursor and VSCode honour the workspace file format.
          </p>
        </div>

        {/* Terminal */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">
            Terminal
            {saved === 'terminal' && <span className="text-emerald-400 text-[11px] ml-2">Saved ✓</span>}
          </label>
          <select
            value={config.terminal}
            onChange={(e) => saveTerminal(e.target.value as TerminalChoice)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500 w-72"
          >
            <option value="auto">
              Auto-detect
              {config.resolvedTerminal
                ? ` (→ ${RESOLVED_TERMINAL_LABEL[config.resolvedTerminal]})`
                : ' (none found)'}
            </option>
            <option value="iterm" disabled={!availability.terminals.iterm}>
              iTerm{availability.terminals.iterm ? '' : ' (not available)'}
            </option>
            <option value="konsole" disabled={!availability.terminals.konsole}>
              Konsole{availability.terminals.konsole ? '' : ' (not available)'}
            </option>
            <option value="gnome-terminal" disabled={!availability.terminals.gnomeTerminal}>
              GNOME Terminal{availability.terminals.gnomeTerminal ? '' : ' (not available)'}
            </option>
            <option value="wt" disabled={!availability.terminals.wt}>
              Windows Terminal{availability.terminals.wt ? '' : ' (not available)'}
            </option>
          </select>
          <p className="text-[11px] text-gray-500 mt-2">
            Opens a new terminal window at the session&rsquo;s working directory. The list reflects what&rsquo;s
            installed on the host running the Workshop server.
          </p>
        </div>
      </div>
    </div>
  );
}
