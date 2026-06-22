import { useState, useEffect } from 'react';

export type ThemeId =
  | 'matrix'
  | 'solarized-dark'
  | 'blue-dark'
  | 'purple-dark'
  | 'ocean'
  | 'light';

export interface Theme {
  id: ThemeId;
  name: string;
  description: string;
  preview: {
    bg: string;
    surface: string;
    accent: string;
    text: string;
  };
}

export const THEMES: Theme[] = [
  {
    id: 'matrix',
    name: 'Matrix',
    description: 'Green phosphor terminal',
    preview: { bg: '#010a01', surface: '#0d1f0d', accent: '#2aaa2a', text: '#a8ffa8' },
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    description: 'Classic Solarized palette',
    preview: { bg: '#002b36', surface: '#073642', accent: '#268bd2', text: '#839496' },
  },
  {
    id: 'blue-dark',
    name: 'Blue Dark',
    description: 'Deep navy blues',
    preview: { bg: '#0d1117', surface: '#1c2a3a', accent: '#3b82f6', text: '#c5ddf0' },
  },
  {
    id: 'purple-dark',
    name: 'Purple Dark',
    description: 'Deep violet',
    preview: { bg: '#0d0b14', surface: '#1e1540', accent: '#8b5cf6', text: '#d4ccee' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    description: 'Teal and cyan depths',
    preview: { bg: '#030d14', surface: '#0d2a3a', accent: '#0891b2', text: '#a0d8e8' },
  },
  {
    id: 'light',
    name: 'Light',
    description: 'Clean light mode',
    preview: { bg: '#f0f4f8', surface: '#ffffff', accent: '#2563eb', text: '#1e293b' },
  },
];

const STORAGE_KEY = 'workshop-theme';
const THEME_SETTING_KEY = 'theme';
const VALID_THEMES = new Set<string>(THEMES.map((t) => t.id));

export function applyTheme(themeId: ThemeId): void {
  document.documentElement.setAttribute('data-theme', themeId);
}

/**
 * Theme is stored per-profile on the server (so it follows you across devices), with
 * localStorage kept as a pre-paint cache to avoid a flash before /api/me resolves.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    return stored ?? 'matrix';
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // On mount, reconcile with the active profile's server-side theme.
  useEffect(() => {
    fetch('/api/me/settings')
      .then((r) => r.json() as Promise<Record<string, string>>)
      .then((s) => {
        const serverTheme = s[THEME_SETTING_KEY];
        if (serverTheme && VALID_THEMES.has(serverTheme)) {
          localStorage.setItem(STORAGE_KEY, serverTheme);
          setThemeState(serverTheme as ThemeId);
          applyTheme(serverTheme as ThemeId);
        }
      })
      .catch(() => {});
  }, []);

  function setTheme(id: ThemeId) {
    localStorage.setItem(STORAGE_KEY, id);
    setThemeState(id);
    applyTheme(id);
    // Persist to the active profile (cookie-scoped); ignore failures (offline/no profile).
    fetch(`/api/me/settings/${THEME_SETTING_KEY}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: id }),
    }).catch(() => {});
  }

  return { theme, setTheme, themes: THEMES };
}
