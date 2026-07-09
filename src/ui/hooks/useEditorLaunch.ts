import { useEffect, useState, useCallback } from 'react';

/** Per-user editor-launch settings (keys live in user_settings). */
export const EDITOR_URI_PREFIX_KEY = 'editor_uri_prefix';
export const EDITOR_PATH_FROM_KEY = 'editor_path_from';
export const EDITOR_PATH_TO_KEY = 'editor_path_to';

interface EditorLaunch {
  /** When set, "Open in Editor" builds `prefix + remappedPath` and opens it client-side. */
  uriPrefix: string;
  pathFrom: string;
  pathTo: string;
  loaded: boolean;
  /** Open `path` in the user's editor — remote URI when configured, else host launch. */
  openInEditor: (path: string, sessionId?: string) => Promise<void>;
}

/**
 * Reads the active profile's editor settings (via the cookie-scoped /api/me/settings)
 * and returns an `openInEditor` that prefers a client-side URI hand-off. The host runs
 * in Docker, so host-side `code <path>` is only a fallback for native installs.
 */
export function useEditorLaunch(): EditorLaunch {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/me/settings')
      .then((r) => r.json() as Promise<Record<string, string>>)
      .then((s) => setSettings(s))
      .catch(() => setSettings({}))
      .finally(() => setLoaded(true));
  }, []);

  const uriPrefix = settings[EDITOR_URI_PREFIX_KEY] ?? '';
  const pathFrom = settings[EDITOR_PATH_FROM_KEY] ?? '';
  const pathTo = settings[EDITOR_PATH_TO_KEY] ?? '';

  const openInEditor = useCallback(
    async (path: string, sessionId?: string) => {
      if (uriPrefix) {
        // Resolve the workspace file (if any) without launching, then build the URI.
        let target = path;
        try {
          const qs = new URLSearchParams({ path });
          if (sessionId) qs.set('sessionId', sessionId);
          const resolved = (await fetch(`/api/shell/resolve-editor-target?${qs}`).then((r) =>
            r.ok ? r.json() : null,
          )) as { path?: string } | null;
          if (resolved?.path) target = resolved.path;
        } catch {
          // Fall back to the raw path if resolution fails.
        }
        if (pathFrom && target.startsWith(pathFrom)) {
          target = pathTo + target.slice(pathFrom.length);
        }
        window.location.href = uriPrefix + target;
        return;
      }
      // Fallback: launch on the host (only meaningful for non-Docker native runs).
      await fetch('/api/shell/open-in-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, sessionId }),
      });
    },
    [uriPrefix, pathFrom, pathTo],
  );

  return { uriPrefix, pathFrom, pathTo, loaded, openInEditor };
}
