import { useState } from 'react';
import type { PrCheckStatus, PrMonitor, PrState, Todo } from '@foundation/types';
import { RefreshButton } from '../shared/RefreshButton';
import { PrCommentList } from './PrCommentList';
import { FailingCheckLog } from './FailingCheckLog';

interface Props {
  todo: Todo;
  monitor: PrMonitor;
  sessionActive: boolean;
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

export function PrAttentionPanel({ todo, monitor, sessionActive, onRefresh }: Props) {
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expandedCommentIds, setExpandedCommentIds] = useState<Set<string>>(new Set());

  const stateBadge = STATE_BADGE[monitor.state];
  const checkBadge = CHECK_BADGE[monitor.checkStatus];
  const needsFix = monitor.checkStatus === 'failing' || monitor.checkStatus === 'error';
  const needsComments = monitor.unresolvedComments.length > 0;
  const isFinished = monitor.state === 'merged' || monitor.state === 'closed';
  const needsAttention = !isFinished && (needsFix || needsComments);
  const isStalePaused = !monitor.monitoring && monitor.pauseReason === 'stale' && !isFinished;

  async function resumeMonitoring() {
    setError(null);
    setSuccess(null);
    setDispatching('resume');
    try {
      const res = await fetch(`/api/pr-monitors/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prUrl: monitor.prUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      }
      setSuccess('Monitoring resumed. Fresh state fetched from GitHub.');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume monitoring');
    } finally {
      setDispatching(null);
    }
  }

  async function sendFix() {
    setError(null);
    setSuccess(null);
    setDispatching('fix');
    try {
      const res = await fetch(`/api/todos/${todo.id}/pr-actions/send-fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prUrl: monitor.prUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      }
      setSuccess('Sent the failing checks to the session.');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send failing checks');
    } finally {
      setDispatching(null);
    }
  }

  async function sendComments(commentIds: string[] | undefined) {
    setError(null);
    setSuccess(null);
    const key = commentIds ? `comment-${commentIds[0]}` : 'all-comments';
    setDispatching(key);
    try {
      const res = await fetch(`/api/todos/${todo.id}/pr-actions/send-comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prUrl: monitor.prUrl, commentIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      }
      const n = commentIds && commentIds.length > 0 ? commentIds.length : monitor.unresolvedComments.length;
      setSuccess(`Sent ${n} comment(s) to the session.`);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send comment feedback');
    } finally {
      setDispatching(null);
    }
  }

  async function dismissComments(commentIds: string[]) {
    setError(null);
    setSuccess(null);
    const key = commentIds.length === 1 ? `comment-${commentIds[0]}` : 'all-comments';
    setDismissing(key);
    try {
      const res = await fetch(`/api/todos/${todo.id}/pr-actions/dismiss-comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prUrl: monitor.prUrl, commentIds }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      }
      setSuccess(commentIds.length === 1 ? 'Comment dismissed.' : `Dismissed ${commentIds.length} comment(s).`);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dismiss comment');
    } finally {
      setDismissing(null);
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
        <RefreshButton
          title="Poll GitHub now"
          onRefresh={async () => {
            await fetch('/api/pr-monitors/poll-now', { method: 'POST' }).catch(() => {});
            onRefresh();
          }}
        />
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
                  {c.detailsUrl && <FailingCheckLog todoId={todo.id} prUrl={monitor.prUrl} checkName={c.name} />}
                </div>
              </li>
            ))}
          </ul>
          <button
            onClick={sendFix}
            disabled={dispatching !== null || !sessionActive}
            className="w-full text-xs px-2 py-1.5 rounded bg-amber-700/80 hover:bg-amber-700 disabled:opacity-50 text-amber-50 font-medium transition-colors"
          >
            {dispatching === 'fix' ? 'Sending…' : 'Send failing checks to session'}
          </button>
          {!sessionActive && (
            <p className="text-[11px] text-gray-500">Session not running — start or resume it to send the failing checks.</p>
          )}
        </div>
      )}

      {needsComments && (
        <PrCommentList
          comments={monitor.unresolvedComments}
          dispatching={dispatching}
          dismissing={dismissing}
          sessionActive={sessionActive}
          expandedCommentIds={expandedCommentIds}
          onToggleExpand={toggleCommentExpansion}
          onSend={sendComments}
          onDismiss={dismissComments}
        />
      )}

      {isStalePaused && (
        <div className="rounded border border-gray-700 bg-gray-900/60 p-2 space-y-2">
          <p className="text-xs text-gray-400">
            Monitoring paused — no push observed in the last hour and no outstanding CI failures or unresolved comments.
            Resume if you're expecting late review feedback.
          </p>
          <button
            onClick={resumeMonitoring}
            disabled={dispatching !== null}
            className="w-full text-xs px-2 py-1.5 rounded bg-blue-700/80 hover:bg-blue-700 disabled:opacity-50 text-blue-50 font-medium transition-colors"
          >
            {dispatching === 'resume' ? 'Resuming…' : 'Resume monitoring'}
          </button>
        </div>
      )}
      {!needsAttention && !isFinished && !isStalePaused && (
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
