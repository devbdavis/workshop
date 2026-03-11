import { useState } from 'react';
import type { TrackSummary } from '@foundation/types';

interface Props {
  summary: TrackSummary | null;
  trackId: string;
  onRefresh: () => void;
}

export function SummaryPanel({ summary, trackId, onRefresh }: Props) {
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await fetch(`/api/tracks/${trackId}/summary/refresh`, { method: 'POST' });
      onRefresh();
    } catch (err) {
      console.error('Failed to refresh summary:', err);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="p-4 border-b border-gray-800">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-300">Summary</h3>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="text-xs text-gray-500 hover:text-gray-300 disabled:opacity-50"
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      {summary ? (
        <>
          <p className="text-sm text-gray-400 whitespace-pre-wrap">{summary.content}</p>
          <p className="text-xs text-gray-600 mt-2">
            v{summary.version} &middot; {new Date(summary.createdAt).toLocaleString()}
          </p>
        </>
      ) : (
        <p className="text-sm text-gray-500 italic">No summary yet. Click refresh to generate.</p>
      )}
    </div>
  );
}
