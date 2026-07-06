import { useState } from 'react';
import type { PrReviewFinding } from '@foundation/types';

interface Props {
  finding: PrReviewFinding;
  prFilesUrl: string;
  disabled: boolean;
  onPatch: (patch: { status?: 'open' | 'dismissed'; suggestedComment?: string }) => Promise<void>;
}

export function FindingCard({ finding, prFilesUrl, disabled, onPatch }: Props) {
  const [comment, setComment] = useState(finding.suggestedComment);
  const dismissed = finding.status === 'dismissed';
  const posted = finding.status === 'posted';

  return (
    <div
      className={`border rounded-md overflow-hidden ${
        dismissed ? 'border-gray-800/60 opacity-50' : 'border-gray-800 bg-gray-900/40'
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 border-b border-gray-800 text-[11px]">
        <a
          href={prFilesUrl}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-gray-300 hover:text-blue-300 truncate"
          title="Open the PR files tab on GitHub"
        >
          {finding.file}
          {finding.line !== undefined && `:${finding.line}`}
        </a>
        {finding.category && (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium text-indigo-300 bg-indigo-900/40">
            {finding.category}
          </span>
        )}
        {!finding.anchored && !dismissed && (
          <span
            className="shrink-0 px-1.5 py-0.5 rounded text-[10px] text-amber-300 bg-amber-900/30"
            title="This line is not part of the diff — the comment will go into the review body instead of inline"
          >
            body-only
          </span>
        )}
        <span className="ml-auto shrink-0 flex items-center gap-1.5">
          {posted && <span className="text-[10px] text-purple-300">posted</span>}
          {!posted && (
            <button
              onClick={() => onPatch({ status: dismissed ? 'open' : 'dismissed' })}
              disabled={disabled}
              className="px-2 py-0.5 text-[10px] font-medium rounded bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 disabled:opacity-50"
            >
              {dismissed ? 'Restore' : 'Meh'}
            </button>
          )}
        </span>
      </div>

      <div className="px-3 py-2 space-y-2">
        <div className="text-xs text-gray-200">{finding.summary}</div>
        {finding.failureScenario && (
          <div className="text-[11px] text-gray-400">
            <span className="text-gray-500">Failure scenario: </span>
            {finding.failureScenario}
          </div>
        )}

        {finding.codeContext && (
          <pre className="text-[11px] leading-4 font-mono bg-gray-950 border border-gray-800 rounded p-2 overflow-x-auto text-gray-400">
            {finding.codeContext.split('\n').map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith('+')
                    ? 'text-emerald-300 bg-emerald-900/20'
                    : line.startsWith('-')
                      ? 'text-red-300 bg-red-900/20'
                      : line.startsWith('@@')
                        ? 'text-blue-400'
                        : undefined
                }
              >
                {line || ' '}
              </div>
            ))}
          </pre>
        )}

        {!dismissed && !posted && (
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onBlur={() => {
              if (comment !== finding.suggestedComment) void onPatch({ suggestedComment: comment });
            }}
            disabled={disabled}
            rows={Math.min(5, Math.max(2, comment.split('\n').length))}
            className="w-full px-2 py-1.5 text-xs bg-gray-950 border border-gray-800 rounded text-gray-200 focus:outline-none focus:border-gray-600 resize-y"
            title="This text is posted as the inline comment — edit freely"
          />
        )}
        {(dismissed || posted) && <div className="text-[11px] text-gray-500 whitespace-pre-wrap">{finding.suggestedComment}</div>}
      </div>
    </div>
  );
}
