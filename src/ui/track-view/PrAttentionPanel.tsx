import { useState } from 'react';
import type { PrCheckStatus, PrMonitor, PrState, Todo } from '@foundation/types';

interface Props {
  todo: Todo;
  monitor: PrMonitor;
  onRefresh: () => void;
}

const STATE_BADGE: Record<PrState, { label: string; className: string }> = {
  open: { label: 'Open', className: 'text-blue-300 bg-blue-900/40' },
  draft: { label: 'Draft', className: 'text-gray-300 bg-gray-700/60' },
  merged: { label: 'Merged', className: 'text-purple-300 bg-purple-900/40' },
  closed: { label: 'Closed', className: 'text-red-300 bg-red-900/40' },
  unknown: { label: '...', className: 'text-gray-400 bg-gray-800' },
};

const CHECK_BADGE: Record<PrCheckStatus, { label: string; className: string }> = {
  none: { label: 'No checks', className: 'text-gray-400 bg-gray-800' },
  pending: { label: 'CI pending', className: 'text-yellow-300 bg-yellow-900/40' },
  passing: { label: 'CI passing', className: 'text-emerald-300 bg-emerald-900/40' },
  failing: { label: 'CI failing', className: 'text-red-300 bg-red-900/40' },
  error: { label: 'CI error', className: 'text-orange-300 bg-orange-900/40' },
};

function shorten(body: string, max = 240): string {
  const trimmed = body.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

export function PrAttentionPanel({ todo, monitor, onRefresh }: Props) {
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expandedCommentIds, setExpandedCommentIds] = useState<Set<string>>(new Set());

  const stateBadge = STATE_BADGE[monitor.state];
  const checkBadge = CHECK_BADGE[monitor.checkStatus];
  const needsFix = monitor.checkStatus === 'failing' || monitor.checkStatus === 'error';
  const needsComments = monitor.unresolvedComments.length > 0;
  const isFinished = monitor.state === 'merged' || monitor.state === 'closed';
  const needsAttention = !isFinished && (needsFix || needsComments);

  async function dispatchFix() {
    setError(null);
    setSuccess(null);
    setDispatching('fix');
    try {
      const res = await fetch(`/api/todos/${todo.id}/pr-actions/dispatch-fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prUrl: monitor.prUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      }
      setSuccess('Dispatched a sub-agent to investigate the failing build.');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dispatch fix');
    } finally {
      setDispatching(null);
    }
  }

  async function dispatchComments(commentIds: string[] | undefined) {
    setError(null);
    setSuccess(null);
    const key = commentIds ? `comment-${commentIds[0]}` : 'all-comments';
    setDispatching(key);
    try {
      const res = await fetch(`/api/todos/${todo.id}/pr-actions/dispatch-comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prUrl: monitor.prUrl, commentIds }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      }
      const label = commentIds && commentIds.length > 0
        ? `Dispatched a sub-agent to address ${commentIds.length} comment(s).`
        : `Dispatched a sub-agent to review all ${monitor.unresolvedComments.length} comment(s).`;
      setSuccess(label);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dispatch comment response');
    } finally {
      setDispatching(null);
    }
  }

  function toggleCommentExpansion(id: string) {
    setExpandedCommentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const headerClass = needsAttention
    ? 'border-amber-700/60 bg-amber-950/30'
    : 'border-gray-700 bg-gray-800/30';

  return (
    <div className={`rounded-lg border ${headerClass} p-3 space-y-3`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium text-gray-200">
              PR #{monitor.prNumber}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${stateBadge.className}`}>{stateBadge.label}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${checkBadge.className}`}>{checkBadge.label}</span>
            {needsComments && (
              <span className="text-[10px] px-1.5 py-0.5 rounded text-pink-300 bg-pink-900/40">
                {monitor.unresolvedComments.length} comment{monitor.unresolvedComments.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <a
            href={monitor.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[11px] text-blue-400 hover:text-blue-300 hover:underline truncate mt-1"
            title={monitor.prUrl}
          >
            {monitor.prTitle ?? monitor.prUrl}
          </a>
        </div>
      </div>

      {needsFix && (
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-amber-400 font-semibold">Failing checks</div>
          <ul className="space-y-1 text-xs text-gray-300">
            {monitor.failingChecks.length === 0 && (
              <li className="text-gray-500 italic">No detail recorded — try opening the PR.</li>
            )}
            {monitor.failingChecks.map((c, i) => (
              <li key={`${c.name}-${i}`} className="flex items-start gap-2">
                <span className="w-1 h-1 rounded-full bg-red-400 mt-1.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    {c.detailsUrl ? (
                      <a className="text-blue-400 hover:text-blue-300" href={c.detailsUrl} target="_blank" rel="noopener noreferrer">{c.name}</a>
                    ) : (
                      c.name
                    )}
                    <span className="text-gray-500 ml-1">— {c.conclusion ?? c.status ?? 'failed'}</span>
                  </div>
                  {c.summary && <p className="text-gray-500 line-clamp-2">{c.summary}</p>}
                </div>
              </li>
            ))}
          </ul>
          <button
            onClick={dispatchFix}
            disabled={dispatching !== null}
            className="w-full text-xs px-2 py-1.5 rounded bg-amber-700/80 hover:bg-amber-700 disabled:opacity-50 text-amber-50 font-medium transition-colors"
          >
            {dispatching === 'fix' ? 'Dispatching…' : 'Investigate & Fix Build'}
          </button>
        </div>
      )}

      {needsComments && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wide text-pink-300 font-semibold">Unresolved comments</div>
            <button
              onClick={() => dispatchComments(undefined)}
              disabled={dispatching !== null || monitor.unresolvedComments.length === 0}
              className="text-[11px] px-2 py-0.5 rounded bg-pink-700/70 hover:bg-pink-700 disabled:opacity-50 text-pink-50 transition-colors"
            >
              {dispatching === 'all-comments' ? 'Dispatching…' : 'Address all'}
            </button>
          </div>
          <ul className="space-y-2">
            {monitor.unresolvedComments.map((c) => {
              const expanded = expandedCommentIds.has(c.id);
              return (
                <li key={c.id} className="rounded border border-gray-700 bg-gray-900/60 p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-gray-300 font-medium">@{c.author}</span>
                      {c.kind === 'review' && c.path && (
                        <span className="text-gray-500 ml-1.5">
                          {c.path}{c.line !== undefined ? `:${c.line}` : ''}
                        </span>
                      )}
                      {c.kind === 'issue' && <span className="text-gray-500 ml-1.5">(PR comment)</span>}
                    </div>
                    <button
                      onClick={() => toggleCommentExpansion(c.id)}
                      className="text-[10px] text-gray-500 hover:text-gray-300 shrink-0"
                    >
                      {expanded ? 'Less' : 'More'}
                    </button>
                  </div>
                  <p className={`mt-1 text-gray-300 whitespace-pre-wrap ${expanded ? '' : 'line-clamp-3'}`}>
                    {expanded ? c.body : shorten(c.body)}
                  </p>
                  <div className="flex items-center justify-between mt-2 gap-2">
                    {c.url ? (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-blue-400 hover:text-blue-300"
                      >
                        Open in GitHub
                      </a>
                    ) : (
                      <span />
                    )}
                    <button
                      onClick={() => dispatchComments([c.id])}
                      disabled={dispatching !== null}
                      className="text-[11px] px-2 py-0.5 rounded bg-pink-700/70 hover:bg-pink-700 disabled:opacity-50 text-pink-50 transition-colors"
                    >
                      {dispatching === `comment-${c.id}` ? 'Dispatching…' : 'Address this'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!needsAttention && !isFinished && (
        <p className="text-xs text-gray-500 italic">
          Waiting on CI checks. Last polled{' '}
          {monitor.lastPolledAt ? new Date(monitor.lastPolledAt).toLocaleTimeString() : 'never'}.
        </p>
      )}
      {isFinished && (
        <p className="text-xs text-gray-500 italic">
          PR is {monitor.state}. Monitoring stopped.
        </p>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
      {success && <p className="text-xs text-emerald-400">{success}</p>}
    </div>
  );
}
