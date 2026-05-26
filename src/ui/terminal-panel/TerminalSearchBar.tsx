import { useEffect, useRef } from 'react';
import type { SearchResultInfo } from './terminal-search';

interface Props {
  query: string;
  onQueryChange: (next: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  result: SearchResultInfo | null;
  /** When this value increments, the input regains focus. */
  focusTrigger: number;
}

function formatCounter(query: string, result: SearchResultInfo | null): string {
  if (!query) return '';
  if (!result || result.resultCount === 0) return 'No matches';
  // resultIndex is -1 when the match cap is exceeded.
  if (result.resultIndex < 0) return `${result.resultCount}+ matches`;
  return `${result.resultIndex + 1} of ${result.resultCount}`;
}

/**
 * Floating search bar pinned to the top-right of the terminal area.
 *
 * Mirrors the affordances of a browser find-bar (input, prev/next, close,
 * match counter) and shares the same keyboard contract:
 *  - Enter            → next
 *  - Shift+Enter      → previous
 *  - Escape           → close
 *
 * The bar shows only while in scrollback mode; the parent owns visibility.
 */
export function TerminalSearchBar({
  query,
  onQueryChange,
  onNext,
  onPrevious,
  onClose,
  result,
  focusTrigger,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [focusTrigger]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) onPrevious();
      else onNext();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const counter = formatCounter(query, result);
  const noMatches = Boolean(query) && result?.resultCount === 0;

  return (
    <div
      className="absolute top-2 right-2 z-20 flex items-center gap-1 rounded-md border border-gray-700 bg-gray-900/95 px-2 py-1 shadow-lg backdrop-blur-sm"
      // Stop wheel events on the bar from bubbling to the terminal's
      // wheel handler (which would scroll the scrollback view).
      onWheel={(e) => e.stopPropagation()}
      // Stop click propagation so the parent container's onClick (which
      // refocuses the terminal) doesn't steal focus from the input as soon
      // as the user clicks into the bar.
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="Find in history"
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className={`w-56 bg-transparent text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none ${
          noMatches ? 'text-red-400' : ''
        }`}
      />
      {counter && (
        <span className="min-w-[5rem] text-right text-xs tabular-nums text-gray-400">
          {counter}
        </span>
      )}
      <button
        type="button"
        onClick={onPrevious}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
        className="rounded p-1 text-gray-300 hover:bg-gray-700 hover:text-gray-100 disabled:opacity-40"
        disabled={!query}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l4-4 4 4" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onNext}
        title="Next match (Enter)"
        aria-label="Next match"
        className="rounded p-1 text-gray-300 hover:bg-gray-700 hover:text-gray-100 disabled:opacity-40"
        disabled={!query}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 5l4 4 4-4" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onClose}
        title="Close (Esc)"
        aria-label="Close search"
        className="rounded p-1 text-gray-300 hover:bg-gray-700 hover:text-gray-100"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3l8 8M11 3l-8 8" />
        </svg>
      </button>
    </div>
  );
}
