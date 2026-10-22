import { useCallback, useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import type { PrReview, PrReviewFinding, PrReviewVerdict } from '@foundation/types';
import { FindingCard } from './FindingCard';
import { STATE_BADGE } from './PrReviewsPage';
import { TerminalModal } from '../track-view/TerminalModal';
import { ConfirmDialog } from '../shared/ConfirmDialog';

interface Props {
  reviewId: string;
  refreshKey: number;
  onChanged: () => void;
  /** Configured review team slug, for the "needs your team's input" banner. */
  team?: string;
}

interface ReviewSessionInfo {
  id: string;
  trackId: string;
  name?: string;
  state: string;
}

type ReviewWithFindings = PrReview & {
  findings: PrReviewFinding[];
  session: ReviewSessionInfo | null;
  currentHeadSha?: string;
  prChangedSinceAnalysis?: boolean;
};

const VERDICT_OPTIONS: Array<{ value: PrReviewVerdict; label: string }> = [
  { value: 'approve', label: 'Approve' },
  { value: 'comment', label: 'Comment only' },
  { value: 'request_changes', label: 'Request changes' },
];

export function PrReviewDetail({ reviewId, refreshKey, onChanged, team }: Props) {
  const [review, setReview] = useState<ReviewWithFindings | null>(null);
  const [summary, setSummary] = useState('');
  const [verdict, setVerdict] = useState<PrReviewVerdict>('comment');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const [pending, setPending] = useState<{ message: string; confirmLabel: string; danger?: boolean; run: () => void } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/pr-reviews/${reviewId}`);
      if (!res.ok) return;
      const data = (await res.json()) as ReviewWithFindings;
      setReview(data);
      // Seed editors from the agent draft, but never clobber in-flight typing on
      // a background refresh — only when switching PRs or when still empty.
      setSummary((prev) => (prev.length === 0 || data.state === 'submitted' ? (data.draftSummary ?? '') : prev));
      setVerdict((prev) => data.suggestedVerdict ?? prev);
    } catch {
      /* keep last state */
    }
  }, [reviewId]);

  useEffect(() => {
    setReview(null);
    setSummary('');
    setVerdict('comment');
    setError(null);
    void load();
  }, [reviewId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
  }, [refreshKey, load]);

  async function call(label: string, path: string, init: RequestInit): Promise<boolean> {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      }
      await load();
      onChanged();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (!review) return <div className="p-6 text-sm text-gray-600">Loading…</div>;

  const badge = STATE_BADGE[review.state];
  const submitted = review.state === 'submitted';
  // A review already on GitHub — including one gone stale behind new commits. Posting
  // again from here would duplicate it, so the draft/finding editors stay closed until
  // a re-analysis lands a fresh set.
  const posted = submitted || review.state === 'needs_rereview';
  const analyzing = review.state === 'analyzing';
  const prChanged = review.prChangedSinceAnalysis === true;
  const prFilesUrl = `${review.prUrl}/files`;
  const openCount = review.findings.filter((f) => f.status === 'open').length;

  function analyze(): void {
    const run = () => void call('analyze', `/api/pr-reviews/${review!.id}/analyze`, { method: 'POST' });
    // The session is gone once reaped as stale, so don't warn about a run that no longer exists.
    if (analyzing && review!.session) {
      setPending({ message: 'An analysis session is already running. Dispatch a fresh one?', confirmLabel: 'Dispatch', run });
      return;
    }
    run();
  }

  function submit(): void {
    setPending({
      message: `Post this review to GitHub (${VERDICT_OPTIONS.find((v) => v.value === verdict)?.label}, ${openCount} comment(s))?`,
      confirmLabel: 'Post review',
      run: () =>
        void call('submit', `/api/pr-reviews/${review!.id}/submit`, {
          method: 'POST',
          body: JSON.stringify({ body: summary, verdict }),
        }),
    });
  }

  return (
    <div className="max-w-4xl mx-auto p-5 space-y-4">
      <header className="space-y-1.5">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold text-gray-100 truncate">{review.prTitle ?? review.prUrl}</h1>
          <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.className}`}>{badge.label}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <a
            href={review.prUrl}
            target="_blank"
            rel="noreferrer"
            className="text-blue-400 hover:text-blue-300"
            title="Open the pull request on GitHub"
          >
            {review.repoOwner}/{review.repoName}#{review.prNumber} ↗
          </a>
          {review.prAuthor && <span>by {review.prAuthor}</span>}
          {review.prBranch && <span className="font-mono">{review.prBranch}</span>}
        </div>
        <div className="flex items-center gap-2 pt-1">
          {(!submitted || prChanged) && (
            <button
              onClick={analyze}
              disabled={busy !== null}
              className="px-3 py-1 text-xs font-medium rounded bg-blue-900/60 text-blue-200 hover:bg-blue-800/60 disabled:opacity-50"
            >
              {busy === 'analyze'
                ? 'Dispatching…'
                : analyzing || submitted || review.findings.length > 0
                  ? 'Re-analyze'
                  : 'Analyze'}
            </button>
          )}
          {review.session && (
            <button
              onClick={() => setShowTerminal(true)}
              className="px-3 py-1 text-xs font-medium rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
              title="Open the review agent's terminal — ask questions or steer the review"
            >
              Chat with agent
            </button>
          )}
          {analyzing && review.session && <span className="text-[11px] text-yellow-300/80">Agent session running in the background…</span>}
          {review.state === 'incoming' && (
            <button
              onClick={() => call('dismiss', `/api/pr-reviews/${review.id}`, { method: 'PATCH', body: JSON.stringify({ state: 'dismissed' }) })}
              disabled={busy !== null}
              className="px-3 py-1 text-xs font-medium rounded bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:opacity-50"
            >
              Dismiss PR
            </button>
          )}
          {review.state === 'dismissed' && (
            <button
              onClick={() => call('restore', `/api/pr-reviews/${review.id}`, { method: 'PATCH', body: JSON.stringify({ state: 'incoming' }) })}
              disabled={busy !== null}
              className="px-3 py-1 text-xs font-medium rounded bg-gray-800 text-gray-400 hover:bg-gray-700 disabled:opacity-50"
            >
              Restore
            </button>
          )}
          <button
            onClick={() =>
              setPending({
                message: 'Remove this PR from the dashboard? Discovery will not re-add it (pasting the URL brings it back).',
                confirmLabel: 'Remove',
                danger: true,
                run: () => void call('remove', `/api/pr-reviews/${review.id}`, { method: 'DELETE' }),
              })
            }
            disabled={busy !== null}
            className="ml-auto px-3 py-1 text-xs font-medium rounded text-red-400/70 hover:text-red-300 hover:bg-red-900/20 disabled:opacity-50"
            title="Remove from the list entirely and block re-discovery"
          >
            Remove
          </button>
        </div>
      </header>

      {error && <div className="px-3 py-2 text-xs text-red-300 bg-red-900/20 border border-red-900/50 rounded">{error}</div>}

      {review.discoveredVia === 'team' && review.state === 'incoming' && (
        <div className="flex items-center gap-3 px-3 py-2 text-xs text-blue-200 bg-blue-900/20 border border-blue-900/50 rounded">
          <span className="flex-1">
            No one from {team || 'your team'} has reviewed or commented on this PR yet, but it needs your team's input.
          </span>
          <button
            onClick={analyze}
            disabled={busy !== null}
            className="shrink-0 px-3 py-1 font-medium rounded bg-blue-900/60 text-blue-200 hover:bg-blue-800/60 disabled:opacity-50"
          >
            {busy === 'analyze' ? 'Dispatching…' : 'Analyze'}
          </button>
        </div>
      )}

      {prChanged && !analyzing && (
        <div className="px-3 py-2 text-xs text-yellow-200 bg-yellow-900/20 border border-yellow-900/50 rounded">
          New commits since the last analysis{posted ? ' (review already posted)' : ''}. Re-analyze to review the new
          changes — previously reported findings won't be repeated.
        </div>
      )}

      {review.prBody && (
        <section className="border border-gray-800 rounded-md bg-gray-900/40">
          <button
            onClick={() => setShowDescription((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-400 hover:text-gray-200"
          >
            <span className="text-[10px]">{showDescription ? '▾' : '▸'}</span>
            Description
          </button>
          {showDescription && (
            <div className="px-3 pb-3 text-sm text-gray-300 markdown-body max-h-80 overflow-y-auto">
              <Markdown>{review.prBody}</Markdown>
            </div>
          )}
        </section>
      )}

      {review.findings.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Findings ({openCount} kept / {review.findings.length})
          </h2>
          {review.findings.map((f) => (
            <FindingCard
              key={f.id}
              finding={f}
              prFilesUrl={prFilesUrl}
              disabled={busy !== null || posted}
              onPatch={async (patch) => {
                await call(`finding-${f.id}`, `/api/pr-reviews/${review.id}/findings/${f.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify(patch),
                });
              }}
            />
          ))}
        </section>
      )}
      {review.state === 'ready' && review.findings.length === 0 && (
        <div className="text-xs text-gray-500">The agent found nothing to flag. Clean PR — write a kind word and approve.</div>
      )}

      {!posted && (review.state === 'ready' || review.findings.length > 0) && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Review comment</h2>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={6}
            placeholder="Overall review comment — the agent drafts one; edit freely. Kept findings are posted as inline comments alongside it."
            className="w-full px-3 py-2 text-xs bg-gray-900 border border-gray-800 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-600 resize-y"
          />
          <div className="flex items-center gap-2">
            <select
              value={verdict}
              onChange={(e) => setVerdict(e.target.value as PrReviewVerdict)}
              className="px-2 py-1 text-xs bg-gray-900 border border-gray-800 rounded text-gray-200 focus:outline-none"
            >
              {VERDICT_OPTIONS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                  {review.suggestedVerdict === v.value ? ' (suggested)' : ''}
                </option>
              ))}
            </select>
            <button
              onClick={submit}
              disabled={busy !== null || summary.trim().length === 0}
              className="px-3 py-1 text-xs font-medium rounded bg-emerald-900/60 text-emerald-200 hover:bg-emerald-800/60 disabled:opacity-50"
              title={summary.trim().length === 0 ? 'Write (or generate) a review comment first' : undefined}
            >
              {busy === 'submit' ? 'Posting…' : `Post review (${openCount} inline comment${openCount === 1 ? '' : 's'})`}
            </button>
          </div>
        </section>
      )}

      {posted && (
        <div className="text-xs text-gray-500">
          Review posted{review.submittedAt ? ` on ${new Date(review.submittedAt).toLocaleString()}` : ''}.{' '}
          <a href={review.prUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300">
            View on GitHub →
          </a>
        </div>
      )}

      {showTerminal && review.session && (
        <TerminalModal
          trackId={review.session.trackId}
          sessionId={review.session.id}
          title={review.session.name || `Review PR #${review.prNumber}`}
          onClose={() => setShowTerminal(false)}
        />
      )}

      {pending && (
        <ConfirmDialog
          message={pending.message}
          confirmLabel={pending.confirmLabel}
          danger={pending.danger}
          onConfirm={() => { const p = pending; setPending(null); p.run(); }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
