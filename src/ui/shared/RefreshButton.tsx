import { useState } from 'react';

interface Props {
  /** Triggers the refresh (typically a poll-now POST + local reload). */
  onRefresh: () => Promise<void>;
  title: string;
  className?: string;
}

/**
 * Tiny ↻ affordance for surfaces backed by a server-side poller.
 * Spins while the forced poll runs; deliberately silent on failure —
 * the next scheduled poll covers it.
 */
export function RefreshButton({ onRefresh, title, className = '' }: Props) {
  const [busy, setBusy] = useState(false);

  async function click() {
    if (busy) return;
    setBusy(true);
    try {
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={click}
      disabled={busy}
      title={title}
      aria-label={title}
      className={`shrink-0 px-1 text-gray-500 hover:text-gray-300 disabled:opacity-50 transition-colors ${className}`}
    >
      <span className={`inline-block text-xs leading-none ${busy ? 'animate-spin' : ''}`}>↻</span>
    </button>
  );
}
