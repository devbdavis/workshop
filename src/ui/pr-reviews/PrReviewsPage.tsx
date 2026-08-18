import { useCallback, useEffect, useState } from 'react';
import type { PrReview, PrReviewState } from '@foundation/types';
import { RefreshButton } from '../shared/RefreshButton';
import { PrReviewDetail } from './PrReviewDetail';

export interface PrReviewListItem extends PrReview {
  findingCounts: { open: number; total: number };
}

const ACTIVE_STATES: ReadonlySet<PrReviewState> = new Set(['incoming', 'analyzing', 'ready']);

export const STATE_BADGE: Record<PrReviewState, { label: string; className: string }> = {
  incoming: { label: 'To review', className: 'text-blue-300 bg-blue-900/40' },
  analyzing: { label: 'Analyzing…', className: 'text-yellow-300 bg-yellow-900/40' },
  ready: { label: 'Findings ready', className: 'text-emerald-300 bg-emerald-900/40' },
  submitted: { label: 'Submitted', className: 'text-purple-300 bg-purple-900/40' },
  dismissed: { label: 'Dismissed', className: 'text-gray-400 bg-gray-800' },
  // Removed rows are filtered out server-side; entry exists for type exhaustiveness.
  removed: { label: 'Removed', className: 'text-gray-500 bg-gray-800' },
};

function SidebarItem({ review, selected, onSelect }: { review: PrReviewListItem; selected: boolean; onSelect: () => void }) {
  const badge = STATE_BADGE[review.state];
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 border-b border-gray-800/60 transition-colors ${
        selected ? 'bg-gray-800/80' : 'hover:bg-gray-900'
      }`}
    >
      <div className="text-xs font-medium text-gray-200 truncate">{review.prTitle ?? review.prUrl}</div>
      <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-500">
        <span className="truncate">
          {review.repoOwner}/{review.repoName}#{review.prNumber}
        </span>
        {review.prAuthor && <span className="shrink-0">by {review.prAuthor}</span>}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.className}`}>{badge.label}</span>
        {review.findingCounts.total > 0 && (
          <span className="px-1.5 py-0.5 rounded text-[10px] text-gray-400 bg-gray-800">
            {review.findingCounts.open}/{review.findingCounts.total} findings
          </span>
        )}
      </div>
    </button>
  );
}

export function PrReviewsPage() {
  const [reviews, setReviews] = useState<PrReviewListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addUrl, setAddUrl] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/pr-reviews');
      if (res.ok) setReviews((await res.json()) as PrReviewListItem[]);
    } catch {
      /* server unreachable — keep last state */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Live updates: discovery poller, agent reports, and submits all broadcast
  // pr-review:updated; session:deleted covers the stale-agent reaper retiring an
  // analysis session out from under an open detail view.
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data);
        if (event.type === 'pr-review:updated' || event.type === 'session:deleted') setRefreshKey((k) => k + 1);
      } catch {
        /* ignore malformed events */
      }
    };
    return () => ws.close();
  }, []);

  async function addPr() {
    const url = addUrl.trim();
    if (!url) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch('/api/pr-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      setAddUrl('');
      setSelectedId((data as PrReview).id);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add PR');
    } finally {
      setAdding(false);
    }
  }

  const active = reviews.filter((r) => ACTIVE_STATES.has(r.state));
  const completed = reviews.filter((r) => !ACTIVE_STATES.has(r.state));
  const selected = reviews.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="h-full flex">
      <aside className="w-80 shrink-0 border-r border-gray-800 flex flex-col bg-gray-950">
        <div className="p-3 border-b border-gray-800">
          <div className="flex gap-1.5">
            <input
              value={addUrl}
              onChange={(e) => setAddUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addPr()}
              placeholder="Add PR by URL…"
              className="flex-1 min-w-0 px-2 py-1 text-xs bg-gray-900 border border-gray-800 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600"
            />
            <button
              onClick={addPr}
              disabled={adding || addUrl.trim().length === 0}
              className="px-2.5 py-1 text-xs font-medium rounded bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50"
            >
              {adding ? '…' : 'Add'}
            </button>
            <RefreshButton
              title="Check for new review requests now"
              onRefresh={async () => {
                await fetch('/api/pr-reviews/poll-now', { method: 'POST' }).catch(() => {});
                setRefreshKey((k) => k + 1);
              }}
            />
          </div>
          {addError && <div className="mt-1.5 text-[10px] text-red-400">{addError}</div>}
        </div>

        <div className="flex-1 overflow-y-auto">
          {active.length === 0 && (
            <div className="px-3 py-4 text-xs text-gray-600">No PRs waiting for your review.</div>
          )}
          {active.map((r) => (
            <SidebarItem key={r.id} review={r} selected={r.id === selectedId} onSelect={() => setSelectedId(r.id)} />
          ))}

          {completed.length > 0 && (
            <>
              <div className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                Completed
              </div>
              {completed.map((r) => (
                <SidebarItem key={r.id} review={r} selected={r.id === selectedId} onSelect={() => setSelectedId(r.id)} />
              ))}
            </>
          )}
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        {selected ? (
          <PrReviewDetail reviewId={selected.id} refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-gray-600">
            Select a PR to review — or add one by URL.
          </div>
        )}
      </main>
    </div>
  );
}
