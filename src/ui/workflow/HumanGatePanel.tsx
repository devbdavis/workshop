import { useState } from 'react';
import type { WorkflowTicket, HumanGateState } from '@foundation/types';

interface Props {
  ticket: WorkflowTicket;
  onApprove: (comment?: string) => void;
  onReject: (comment?: string) => void;
}

const GATE_MESSAGES: Record<HumanGateState, { heading: string; description: string }> = {
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
      'Review the completed implementation with PR links below and approve to merge, or reject to request fixes.',
  },
};

function isHumanGate(state: string): state is HumanGateState {
  return state === 'spec-review' || state === 'plan-review' || state === 'final-review';
}

export function HumanGatePanel({ ticket, onApprove, onReject }: Props) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isHumanGate(ticket.state)) return null;

  const gate = GATE_MESSAGES[ticket.state];

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
      <p className="text-xs text-gray-400 mb-4">{gate.description}</p>

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
