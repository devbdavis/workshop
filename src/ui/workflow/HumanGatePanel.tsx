import { useState } from 'react';
import type { WorkflowTicket, WorkflowTransition } from '@foundation/types.js';

// Legacy human gate states (for backward compatibility with tickets without templates)
type LegacyHumanGateState = 'spec-review' | 'plan-review' | 'final-review';

interface Props {
  ticket: WorkflowTicket;
  transitions?: WorkflowTransition[];
  onApprove: (comment?: string) => void;
  onReject: (comment?: string) => void;
}

const LEGACY_GATE_MESSAGES: Record<LegacyHumanGateState, { heading: string; description: string }> = {
  'spec-review': {
    heading: 'This specification is ready for your review',
    description:
      'Review the specification below and approve to start technical planning, or reject to send back for refinement.',
  },
  'plan-review': {
    heading: 'This technical plan is ready for your review',
    description:
      'Review the technical plan below and approve to begin implementation, or reject to send back for revision.',
  },
  'final-review': {
    heading: 'This implementation is ready for your review',
    description:
      'Review the completed implementation and approve to merge, or reject to request fixes.',
  },
};

// Messages for dynamic workflow human gates keyed by state name
const DYNAMIC_GATE_MESSAGES: Record<string, { heading: string; description: string }> = {
  'decomposition-review': {
    heading: 'Task decomposition ready for review',
    description: 'Review the proposed task breakdown below and approve to begin execution, or reject to revise.',
  },
  'code-review': {
    heading: 'Code changes ready for review',
    description: 'Review the implementation and approve to complete, or reject to request changes.',
  },
  'integration-review': {
    heading: 'All tasks complete — ready for integration review',
    description: 'All child tasks have finished. Review the full implementation and approve to close the epic, or reject to request fixes.',
  },
};

function getDefaultGateMessage(state: string): { heading: string; description: string } {
  if (DYNAMIC_GATE_MESSAGES[state]) return DYNAMIC_GATE_MESSAGES[state];
  // Derive from state name as last resort
  const label = state.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return {
    heading: `${label} — awaiting your decision`,
    description: 'Review the current state and approve to continue, or reject to send back for revision.',
  };
}

/** Extract URLs that look like PR links from text */
function extractPrLinks(text: string): string[] {
  const urlRegex = /https?:\/\/github\.com\/[^\s)]+\/pull\/\d+/g;
  return [...new Set(text.match(urlRegex) ?? [])];
}

/** Find review context relevant to the current human gate */
function findReviewContext(transitions: WorkflowTransition[], currentState: string): {
  prLinks: string[];
  summaryComment: string | null;
} {
  const prLinks: string[] = [];
  let summaryComment: string | null = null;

  // Walk transitions looking for PR links (from any transition)
  for (const t of transitions) {
    if (!t.comment) continue;
    const links = extractPrLinks(t.comment);
    prLinks.push(...links);
  }

  // Only show a summary if it's from the transition INTO this state.
  // Don't fall back to older unrelated transitions — showing a decomposer's
  // comment on an integration-review gate is actively misleading.
  for (const t of transitions) {
    if (t.toState === currentState && t.comment && t.comment.length > 20) {
      summaryComment = t.comment;
      break;
    }
  }

  return { prLinks: [...new Set(prLinks)], summaryComment };
}

function isLegacyHumanGate(state: string): state is LegacyHumanGateState {
  return state === 'spec-review' || state === 'plan-review' || state === 'final-review';
}

/** Check if a ticket is at a human gate (dynamic template or legacy fallback) */
function isAtHumanGate(ticket: WorkflowTicket): boolean {
  const sd = ticket.stateData as Record<string, unknown> | undefined;
  // Dynamic workflow check via stateData
  if (sd?.currentStateHumanGate === true) return true;
  // Legacy fallback
  return isLegacyHumanGate(ticket.state);
}

/** Get gate message for current state */
function getGateMessage(ticket: WorkflowTicket): { heading: string; description: string } {
  const sd = ticket.stateData as Record<string, unknown> | undefined;

  // Check for custom message from dynamic workflow
  if (sd?.humanGatePrompt && typeof sd.humanGatePrompt === 'string') {
    return { heading: 'Human review required', description: sd.humanGatePrompt };
  }

  // Legacy message lookup
  if (isLegacyHumanGate(ticket.state)) {
    return LEGACY_GATE_MESSAGES[ticket.state];
  }

  // Dynamic state fallback
  return getDefaultGateMessage(ticket.state);
}

export function HumanGatePanel({ ticket, transitions, onApprove, onReject }: Props) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isAtHumanGate(ticket)) return null;

  const gate = getGateMessage(ticket);
  const { prLinks, summaryComment } = findReviewContext(transitions ?? [], ticket.state);

  async function handleApprove() {
    setSubmitting(true);
    try {
      onApprove(comment.trim() || undefined);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    setSubmitting(true);
    try {
      onReject(comment.trim() || undefined);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border border-amber-800/50 bg-amber-950/30 rounded-lg p-4 mb-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
        <h3 className="text-sm font-semibold text-amber-300">Human Review Required</h3>
      </div>

      {/* Message */}
      <p className="text-sm text-amber-200 font-medium mb-1">{gate.heading}</p>
      <p className="text-xs text-gray-400 mb-3">{gate.description}</p>

      {/* PR links */}
      {prLinks.length > 0 && (
        <div className="mb-3">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
            Pull Requests
          </h4>
          <ul className="space-y-1">
            {prLinks.map((link) => (
              <li key={link}>
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-400 hover:text-blue-300 underline break-all"
                >
                  {link}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Agent summary */}
      {summaryComment && (
        <details className="mb-3">
          <summary className="text-xs font-semibold text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-300">
            Agent Summary
          </summary>
          <div className="mt-2 text-xs text-gray-400 whitespace-pre-wrap bg-gray-900/50 rounded p-3 max-h-60 overflow-y-auto">
            {summaryComment}
          </div>
        </details>
      )}

      {/* Comment textarea */}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional review comment..."
        className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-300 placeholder-gray-600 mb-3"
        rows={3}
      />

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleApprove}
          disabled={submitting}
          className="px-4 py-2 text-sm font-medium bg-green-800 hover:bg-green-700 text-green-200 rounded transition-colors disabled:opacity-50"
        >
          Approve
        </button>
        <button
          onClick={handleReject}
          disabled={submitting}
          className="px-4 py-2 text-sm font-medium bg-red-900 hover:bg-red-800 text-red-200 rounded transition-colors disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
