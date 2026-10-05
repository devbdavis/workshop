import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  applyPathRemaps,
  parsePathRemaps,
  remapTextFromSettings,
  EDITOR_URI_PREFIX_KEY,
} from '@foundation/path-remap';

export {
  EDITOR_URI_PREFIX_KEY,
  EDITOR_PATH_REMAPS_KEY,
  EDITOR_PATH_FROM_KEY,
  EDITOR_PATH_TO_KEY,
} from '@foundation/path-remap';

interface EditorLaunch {
  /** When set, "Open in Editor" builds `prefix + remappedPath` and opens it client-side. */
  uriPrefix: string;
  /** The profile's `<from> -> <to>` remap rules, as saved text. */
  remapText: string;
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
  const remapText = remapTextFromSettings(settings);
  const remaps = useMemo(() => parsePathRemaps(remapText), [remapText]);

  const openInEditor = useCallback(
    async (path: string, sessionId?: string) => {
      if (uriPrefix) {
        // Resolve the workspace file (if any) without launching, then build the URI.
        let target = path;
        try {
          const qs = new URLSearchParams({ path });
          if (sessionId) qs.set('sessionId', sessionId);
          qs.set('portable', '1');
          const resolved = (await fetch(`/api/shell/resolve-editor-target?${qs}`).then((r) =>
            r.ok ? r.json() : null,
          )) as { path?: string } | null;
          if (resolved?.path) target = resolved.path;
        } catch {
          // Fall back to the raw path if resolution fails.
        }
        window.location.href = uriPrefix + applyPathRemaps(target, remaps);
        return;
      }
      // Fallback: launch on the host (only meaningful for non-Docker native runs).
      await fetch('/api/shell/open-in-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, sessionId }),
      });
    },
    [uriPrefix, remaps],
  );

  return { uriPrefix, remapText, loaded, openInEditor };
}
