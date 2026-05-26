/**
 * Search wiring for xterm.js scrollback.
 *
 * The live terminal runs on tmux's alternate screen (no xterm-side scrollback),
 * so all searching happens on the scrollback overlay terminal — the one that
 * appears when the user scrolls up or invokes the search shortcut.  We load
 * `@xterm/addon-search` onto that terminal and expose a thin imperative API
 * (`findNext`/`findPrevious`/`clear`/`dispose`) plus a `onResultChange`
 * subscription that the React search bar consumes.
 */

import type { Terminal } from '@xterm/xterm';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';

/**
 * Decoration colors for match highlighting.  Match background is a muted
 * yellow that survives over the terminal's dark background; the active
 * match gets a brighter orange so the user can spot the cursor position
 * after pressing Enter.
 */
const SEARCH_DECORATIONS = {
  matchBackground: '#665c1e',
  matchOverviewRuler: '#facc15',
  activeMatchBackground: '#a16207',
  activeMatchColorOverviewRuler: '#fb923c',
} as const;

export interface SearchResultInfo {
  resultIndex: number;
  resultCount: number;
}

export interface SearchSession {
  findNext(query: string): void;
  findPrevious(query: string): void;
  /** Drop highlights/selection without disposing the addon. */
  clear(): void;
  /** Subscribe to result-count changes.  Returns an unsubscribe function. */
  onResultChange(listener: (info: SearchResultInfo) => void): () => void;
  dispose(): void;
}

const BASE_OPTIONS: ISearchOptions = {
  decorations: SEARCH_DECORATIONS,
  caseSensitive: false,
  regex: false,
  wholeWord: false,
};

export function createSearchSession(term: Terminal): SearchSession {
  const addon = new SearchAddon();
  term.loadAddon(addon);

  const findNext = (query: string): void => {
    if (!query) {
      addon.clearDecorations();
      return;
    }
    addon.findNext(query, { ...BASE_OPTIONS, incremental: true });
  };

  const findPrevious = (query: string): void => {
    if (!query) {
      addon.clearDecorations();
      return;
    }
    addon.findPrevious(query, BASE_OPTIONS);
  };

  const clear = (): void => {
    addon.clearDecorations();
  };

  const onResultChange = (listener: (info: SearchResultInfo) => void): (() => void) => {
    const sub = addon.onDidChangeResults(listener);
    return () => sub.dispose();
  };

  const dispose = (): void => {
    addon.dispose();
  };

  return { findNext, findPrevious, clear, onResultChange, dispose };
}
