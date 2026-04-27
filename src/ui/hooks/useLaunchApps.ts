import { useEffect, useState } from 'react';

export type EditorChoice = 'auto' | 'cursor' | 'code';
export type TerminalChoice = 'auto' | 'iterm' | 'konsole' | 'gnome-terminal' | 'wt';

export interface LaunchAppsConfig {
  editor: EditorChoice;
  terminal: TerminalChoice;
  resolvedEditor: 'cursor' | 'code' | null;
  resolvedTerminal: 'iterm' | 'konsole' | 'gnome-terminal' | 'wt' | null;
  availability: {
    platform: 'darwin' | 'linux' | 'wsl' | 'unknown';
    editors: { cursor: boolean; code: boolean };
    terminals: { iterm: boolean; konsole: boolean; gnomeTerminal: boolean; wt: boolean };
  };
}

const EDITOR_LABEL: Record<NonNullable<LaunchAppsConfig['resolvedEditor']>, string> = {
  cursor: 'Cursor',
  code: 'VSCode',
};

const TERMINAL_LABEL: Record<NonNullable<LaunchAppsConfig['resolvedTerminal']>, string> = {
  iterm: 'iTerm',
  konsole: 'Konsole',
  'gnome-terminal': 'Terminal',
  wt: 'Windows Terminal',
};

let cached: LaunchAppsConfig | null = null;
let inFlight: Promise<LaunchAppsConfig | null> | null = null;

async function fetchConfig(): Promise<LaunchAppsConfig | null> {
  if (cached) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch('/api/settings/launch-apps');
      if (!res.ok) return null;
      const data = (await res.json()) as LaunchAppsConfig;
      cached = data;
      return data;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Invalidate the cache after a settings save so the next reader picks up changes. */
export function invalidateLaunchAppsCache(): void {
  cached = null;
}

/**
 * Lightweight read-only hook for components that just want display labels.
 * Shared cache across all consumers — config rarely changes during a session.
 */
export function useLaunchApps(): LaunchAppsConfig | null {
  const [config, setConfig] = useState<LaunchAppsConfig | null>(cached);
  useEffect(() => {
    if (cached) {
      setConfig(cached);
      return;
    }
    let cancelled = false;
    fetchConfig().then((c) => { if (!cancelled) setConfig(c); });
    return () => { cancelled = true; };
  }, []);
  return config;
}

export function editorLabel(config: LaunchAppsConfig | null): string {
  return config?.resolvedEditor ? EDITOR_LABEL[config.resolvedEditor] : 'Editor';
}

export function terminalLabel(config: LaunchAppsConfig | null): string {
  return config?.resolvedTerminal ? TERMINAL_LABEL[config.resolvedTerminal] : 'Terminal';
}
