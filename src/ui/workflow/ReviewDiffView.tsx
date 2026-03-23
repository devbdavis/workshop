/**
 * ReviewDiffView — shows before/after template changes proposed by the
 * workflow review skill. Provides accept/reject/modify actions.
 */
import { useState } from 'react';

// Mirrors SuggestedChange from workflow schemas
interface SuggestedChange {
  type: 'add-state' | 'remove-state' | 'modify-transition' | 'modify-agent' | 'modify-prompt';
  description: string;
  before?: unknown;
  after?: unknown;
}

// Mirrors ReviewFinding from workflow schemas
interface ReviewFinding {
  category: string;
  description: string;
  severity: 'info' | 'warning' | 'actionable';
  stateRef?: string;
}

interface ReviewDiffViewProps {
  reviewId: string;
  templateRowId: string;
  findings: ReviewFinding[];
  suggestedChanges: SuggestedChange[];
  onAccept: (reviewId: string) => Promise<void>;
  onReject: (reviewId: string) => Promise<void>;
}

const SEVERITY_STYLES: Record<string, string> = {
  info: 'border-blue-800/50 bg-blue-950/30 text-blue-300',
  warning: 'border-amber-800/50 bg-amber-950/30 text-amber-300',
  actionable: 'border-red-800/50 bg-red-950/30 text-red-300',
};

const CHANGE_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  'add-state': { label: 'Add State', color: 'text-green-400 bg-green-900/40' },
  'remove-state': { label: 'Remove State', color: 'text-red-400 bg-red-900/40' },
  'modify-transition': { label: 'Modify Transition', color: 'text-blue-400 bg-blue-900/40' },
  'modify-agent': { label: 'Modify Agent', color: 'text-purple-400 bg-purple-900/40' },
  'modify-prompt': { label: 'Modify Prompt', color: 'text-cyan-400 bg-cyan-900/40' },
};

export function ReviewDiffView({
  reviewId,
  templateRowId,
  findings,
  suggestedChanges,
  onAccept,
  onReject,
}: ReviewDiffViewProps) {
  const [submitting, setSubmitting] = useState<'accept' | 'reject' | null>(null);

  async function handleAction(action: 'accept' | 'reject') {
    setSubmitting(action);
    try {
      if (action === 'accept') {
        await onAccept(reviewId);
      } else {
        await onReject(reviewId);
      }
    } finally {
      setSubmitting(null);
    }
  }

  const actionableFindings = findings.filter((f) => f.severity === 'actionable');
  const warningFindings = findings.filter((f) => f.severity === 'warning');
  const infoFindings = findings.filter((f) => f.severity === 'info');

  return (
    <div className="space-y-4">
      {/* Findings summary */}
      <div>
        <h3 className="text-sm font-medium text-gray-300 mb-2">Review Findings</h3>
        {findings.length === 0 ? (
          <p className="text-xs text-gray-500 italic">No findings.</p>
        ) : (
          <div className="space-y-2">
            {[...actionableFindings, ...warningFindings, ...infoFindings].map((finding, i) => (
              <div
                key={i}
                className={`border rounded px-3 py-2 text-xs ${SEVERITY_STYLES[finding.severity] ?? SEVERITY_STYLES.info}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium uppercase tracking-wide text-[10px]">
                    {finding.severity}
                  </span>
                  <span className="text-gray-500">{finding.category}</span>
                  {finding.stateRef && (
                    <span className="px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded text-[10px]">
                      {finding.stateRef}
                    </span>
                  )}
                </div>
                <p>{finding.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Suggested changes diff */}
      {suggestedChanges.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-300 mb-2">Suggested Changes</h3>
          <div className="space-y-3">
            {suggestedChanges.map((change, i) => {
              const typeInfo = CHANGE_TYPE_LABELS[change.type] ?? {
                label: change.type,
                color: 'text-gray-400 bg-gray-800',
              };

              return (
                <div key={i} className="border border-gray-800 rounded-lg overflow-hidden">
                  {/* Change header */}
                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-900/80 border-b border-gray-800">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${typeInfo.color}`}>
                      {typeInfo.label}
                    </span>
                    <span className="text-xs text-gray-300">{change.description}</span>
                  </div>

                  {/* Before/After diff */}
                  {(change.before != null || change.after != null) && (
                    <div className="grid grid-cols-2 divide-x divide-gray-800 text-[11px] font-mono">
                      <div className="p-3 bg-red-950/10">
                        <div className="text-[10px] text-red-400/70 font-sans mb-1 uppercase tracking-wide">
                          Before
                        </div>
                        <pre className="text-gray-400 whitespace-pre-wrap break-all">
                          {change.before != null
                            ? typeof change.before === 'string'
                              ? change.before
                              : JSON.stringify(change.before, null, 2)
                            : '(none)'}
                        </pre>
                      </div>
                      <div className="p-3 bg-green-950/10">
                        <div className="text-[10px] text-green-400/70 font-sans mb-1 uppercase tracking-wide">
                          After
                        </div>
                        <pre className="text-gray-400 whitespace-pre-wrap break-all">
                          {change.after != null
                            ? typeof change.after === 'string'
                              ? change.after
                              : JSON.stringify(change.after, null, 2)
                            : '(none)'}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3 pt-2 border-t border-gray-800">
        <button
          onClick={() => handleAction('accept')}
          disabled={submitting !== null}
          className="px-4 py-1.5 text-xs bg-green-800 hover:bg-green-700 text-green-200 rounded transition-colors disabled:opacity-50"
        >
          {submitting === 'accept' ? 'Applying...' : 'Accept Changes'}
        </button>
        <button
          onClick={() => handleAction('reject')}
          disabled={submitting !== null}
          className="px-4 py-1.5 text-xs bg-red-900 hover:bg-red-800 text-red-200 rounded transition-colors disabled:opacity-50"
        >
          {submitting === 'reject' ? 'Rejecting...' : 'Reject'}
        </button>
        <span className="text-[10px] text-gray-600 ml-auto">
          Template: {templateRowId.slice(0, 8)}
        </span>
      </div>
    </div>
  );
}
