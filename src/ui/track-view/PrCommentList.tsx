import Markdown from 'react-markdown';
import type { PrComment } from '@foundation/types';

interface Props {
  comments: PrComment[];
  dispatching: string | null;
  dismissing: string | null;
  sessionActive: boolean;
  expandedCommentIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onSend: (commentIds: string[] | undefined) => void;
  onDismiss: (commentIds: string[]) => void;
}

export function PrCommentList({
  comments,
  dispatching,
  dismissing,
  sessionActive,
  expandedCommentIds,
  onToggleExpand,
  onSend,
  onDismiss,
}: Props) {
  const busy = dispatching !== null || dismissing !== null;
  const addressDisabled = busy || comments.length === 0 || !sessionActive;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wide text-pink-300 font-semibold">Unresolved comments</div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onDismiss(comments.map((c) => c.id))}
            disabled={busy || comments.length === 0}
            className="text-[11px] px-2 py-0.5 rounded bg-gray-700/70 hover:bg-gray-700 disabled:opacity-50 text-gray-300 transition-colors"
          >
            {dismissing === 'all-comments' ? 'Dismissing…' : 'Dismiss all'}
          </button>
          <button
            onClick={() => onSend(undefined)}
            disabled={addressDisabled}
            className="text-[11px] px-2 py-0.5 rounded bg-pink-700/70 hover:bg-pink-700 disabled:opacity-50 text-pink-50 transition-colors"
          >
            {dispatching === 'all-comments' ? 'Sending…' : 'Address all'}
          </button>
        </div>
      </div>
      {!sessionActive && (
        <p className="text-[11px] text-gray-500">Session not running — start or resume it to send feedback.</p>
      )}
      <ul className="space-y-2">
        {comments.map((c) => {
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
                  onClick={() => onToggleExpand(c.id)}
                  className="text-[10px] text-gray-500 hover:text-gray-300 shrink-0"
                >
                  {expanded ? 'Less' : 'More'}
                </button>
              </div>
              <div
                className={`mt-1 text-gray-300 prose prose-invert prose-sm max-w-none prose-p:my-1 prose-pre:my-1 prose-headings:my-1 ${expanded ? '' : 'max-h-20 overflow-hidden'}`}
              >
                <Markdown>{c.body}</Markdown>
              </div>
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
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onDismiss([c.id])}
                    disabled={busy}
                    className="text-[11px] px-2 py-0.5 rounded bg-gray-700/70 hover:bg-gray-700 disabled:opacity-50 text-gray-300 transition-colors"
                  >
                    {dismissing === `comment-${c.id}` ? 'Dismissing…' : 'Dismiss'}
                  </button>
                  <button
                    onClick={() => onSend([c.id])}
                    disabled={busy || !sessionActive}
                    className="text-[11px] px-2 py-0.5 rounded bg-pink-700/70 hover:bg-pink-700 disabled:opacity-50 text-pink-50 transition-colors"
                  >
                    {dispatching === `comment-${c.id}` ? 'Sending…' : 'Address this'}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
