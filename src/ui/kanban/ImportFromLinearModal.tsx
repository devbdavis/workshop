import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ImportableIssue, Track } from '@foundation/types';

interface Props {
  tracks: Track[];
  onClose: () => void;
  /**
   * Called after a successful import so the parent (Kanban board) can refresh
   * its todo list. Fired once per successful import.
   */
  onImported: () => void;
}

type TabId = 'available' | 'imported' | 'ignored';

/** Trackers that support the import flow; others (jira/none) show a message instead of fetching. */
type ImportSource = 'linear' | 'github';

const SOURCE_LABELS: Record<ImportSource, string> = { linear: 'Linear', github: 'GitHub' };

interface IssueListResponse {
  available: ImportableIssue[];
  imported: ImportableIssue[];
  ignored: ImportableIssue[];
}

interface RowState {
  /** Per-row track selection — defaults to the first track but can be changed. */
  trackId: string;
  /** True while the issue is mid-import; disables buttons until the request settles. */
  busy: boolean;
}

function priorityLabel(p?: number): string {
  // Linear priorities: 0 = no priority, 1 = urgent, 2 = high, 3 = medium, 4 = low
  switch (p) {
    case 1: return 'Urgent';
    case 2: return 'High';
    case 3: return 'Medium';
    case 4: return 'Low';
    default: return '';
  }
}

function priorityClasses(p?: number): string {
  switch (p) {
    case 1: return 'bg-red-900/50 text-red-300';
    case 2: return 'bg-orange-900/50 text-orange-300';
    case 3: return 'bg-yellow-900/50 text-yellow-300';
    case 4: return 'bg-gray-800 text-gray-400';
    default: return 'bg-gray-800 text-gray-500';
  }
}

export function ImportFromLinearModal({ tracks, onClose, onImported }: Props) {
  const [tab, setTab] = useState<TabId>('available');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<IssueListResponse>({ available: [], imported: [], ignored: [] });
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  // undefined = still checking settings; null = current tracker has no import support (jira/none).
  const [source, setSource] = useState<ImportSource | null | undefined>(undefined);

  const defaultTrackId = tracks[0]?.id ?? '';

  useEffect(() => {
    fetch('/api/settings/issue-tracker')
      .then((r) => r.json())
      .then((data: { tracker: string }) => {
        setSource(data.tracker === 'linear' || data.tracker === 'github' ? data.tracker : null);
      })
      .catch(() => setSource(null));
  }, []);

  const loadIssues = useCallback(async () => {
    if (!source) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ticket-import/${source}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Request failed: ${res.status}`);
        setIssues({ available: [], imported: [], ignored: [] });
        return;
      }
      const data = (await res.json()) as IssueListResponse;
      setIssues(data);
      // Seed row-state with the default track for any issues we haven't seen yet.
      setRowStates((prev) => {
        const next = { ...prev };
        for (const list of [data.available, data.ignored]) {
          for (const issue of list) {
            if (!next[issue.externalId]) {
              next[issue.externalId] = { trackId: defaultTrackId, busy: false };
            }
          }
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to load ${SOURCE_LABELS[source]} issues`);
    } finally {
      setLoading(false);
    }
  }, [defaultTrackId, source]);

  useEffect(() => {
    if (source) loadIssues();
  }, [source, loadIssues]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const setRow = useCallback((externalId: string, patch: Partial<RowState>) => {
    setRowStates((prev) => ({
      ...prev,
      [externalId]: { ...(prev[externalId] ?? { trackId: defaultTrackId, busy: false }), ...patch },
    }));
  }, [defaultTrackId]);

  async function importIssue(issue: ImportableIssue) {
    if (!source) return;
    const state = rowStates[issue.externalId] ?? { trackId: defaultTrackId, busy: false };
    if (!state.trackId) {
      setError('Select a track before importing.');
      return;
    }
    setRow(issue.externalId, { busy: true });
    try {
      const res = await fetch(`/api/ticket-import/${source}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ externalId: issue.externalId, trackId: state.trackId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Import failed: ${res.status}`);
        return;
      }
      onImported();
      await loadIssues();
    } finally {
      setRow(issue.externalId, { busy: false });
    }
  }

  async function ignoreIssue(issue: ImportableIssue) {
    if (!source) return;
    setRow(issue.externalId, { busy: true });
    try {
      const res = await fetch(`/api/ticket-import/${source}/ignore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          externalId: issue.externalId,
          cachedTitle: issue.title,
          cachedUrl: issue.url,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Ignore failed: ${res.status}`);
        return;
      }
      await loadIssues();
    } finally {
      setRow(issue.externalId, { busy: false });
    }
  }

  async function unignoreIssue(issue: ImportableIssue) {
    if (!source) return;
    setRow(issue.externalId, { busy: true });
    try {
      const res = await fetch(`/api/ticket-import/${source}/ignore/${encodeURIComponent(issue.externalId)}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 404) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Unignore failed: ${res.status}`);
        return;
      }
      await loadIssues();
    } finally {
      setRow(issue.externalId, { busy: false });
    }
  }

  const currentList = useMemo(() => {
    if (tab === 'available') return issues.available;
    if (tab === 'imported') return issues.imported;
    return issues.ignored;
  }, [tab, issues]);

  const sourceLabel = source ? SOURCE_LABELS[source] : 'issues';

  if (source === null) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
        <div
          className="bg-gray-900 border border-gray-700 rounded-xl w-[420px] mx-4 overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
            <h2 className="text-sm font-semibold text-gray-200">Import Issues</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">&times;</button>
          </div>
          <p className="p-5 text-xs text-gray-400">
            Issue import is only available for Linear and GitHub. Configure it in Settings → Issue Tracking.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-[80vw] h-[80vh] mx-4 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
          <h2 className="text-sm font-semibold text-gray-200">Import from {sourceLabel}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">&times;</button>
        </div>

        <div className="px-5 py-2 border-b border-gray-800 flex items-center gap-1 shrink-0">
          {([
            { id: 'available', label: 'Available', count: issues.available.length },
            { id: 'imported', label: 'Already Imported', count: issues.imported.length },
            { id: 'ignored', label: 'Ignored', count: issues.ignored.length },
          ] as { id: TabId; label: string; count: number }[]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                tab === t.id ? 'bg-gray-800 text-gray-100' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'
              }`}
            >
              {t.label} <span className="text-gray-500">({t.count})</span>
            </button>
          ))}
          <button
            onClick={loadIssues}
            disabled={loading}
            className="ml-auto px-2 py-1 text-[11px] text-gray-400 hover:text-gray-200 disabled:opacity-50"
            title={`Refresh from ${sourceLabel}`}
          >
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>

        {error && (
          <div className="px-5 py-2 border-b border-red-900/50 bg-red-950/40 text-xs text-red-300 shrink-0">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-xs text-gray-500">Loading issues from {sourceLabel}…</div>
          ) : currentList.length === 0 ? (
            <div className="p-8 text-xs text-gray-500">
              {tab === 'available' && 'No open issues assigned to you.'}
              {tab === 'imported' && 'No issues have been imported yet.'}
              {tab === 'ignored' && 'No ignored issues.'}
            </div>
          ) : (
            <ul className="divide-y divide-gray-800">
              {currentList.map((issue) => {
                const state = rowStates[issue.externalId] ?? { trackId: defaultTrackId, busy: false };
                return (
                  <li key={issue.externalId} className="p-4 hover:bg-gray-850/40">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <a
                            href={issue.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-mono text-blue-400 hover:text-blue-300 hover:underline"
                          >
                            {issue.externalId}
                          </a>
                          {issue.projectName && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 truncate max-w-[160px]">
                              {issue.projectName}
                            </span>
                          )}
                          {issue.stateName && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                              {issue.stateName}
                            </span>
                          )}
                          {priorityLabel(issue.priority) && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${priorityClasses(issue.priority)}`}>
                              {priorityLabel(issue.priority)}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-200 leading-snug break-words">{issue.title}</p>
                        {issue.description && (
                          <p className="text-xs text-gray-500 leading-snug mt-1 line-clamp-2 whitespace-pre-wrap">
                            {issue.description.slice(0, 300)}
                            {issue.description.length > 300 ? '…' : ''}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0 w-56">
                        {tab === 'available' && (
                          <>
                            <select
                              value={state.trackId}
                              onChange={(e) => setRow(issue.externalId, { trackId: e.target.value })}
                              disabled={state.busy}
                              className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 disabled:opacity-50"
                            >
                              {tracks.length === 0 && <option value="">No tracks available</option>}
                              {tracks.map((t) => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </select>
                            <div className="flex gap-1.5 w-full">
                              <button
                                onClick={() => importIssue(issue)}
                                disabled={state.busy || !state.trackId}
                                className="flex-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded transition-colors"
                              >
                                {state.busy ? '…' : 'Import'}
                              </button>
                              <button
                                onClick={() => ignoreIssue(issue)}
                                disabled={state.busy}
                                className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 rounded transition-colors"
                                title="Hide this issue from the import list"
                              >
                                Ignore
                              </button>
                            </div>
                          </>
                        )}

                        {tab === 'ignored' && (
                          <button
                            onClick={() => unignoreIssue(issue)}
                            disabled={state.busy}
                            className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors w-full"
                          >
                            {state.busy ? '…' : 'Unignore'}
                          </button>
                        )}

                        {tab === 'imported' && (
                          <span className="text-[11px] text-emerald-400">Already imported</span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-800 shrink-0 flex items-center justify-between">
          <p className="text-[11px] text-gray-500">
            Shows open issues assigned to you across every {sourceLabel} project.
          </p>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
