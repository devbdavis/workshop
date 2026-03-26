/**
 * WorkflowAssignmentPanel — Shows workflow template proposal for a ticket
 * and allows approval to start the workflow.
 */
import { useState } from 'react';
import type { WorkflowTicket } from '@foundation/types.js';

// Capability tier colors (from schema definition)
const TIER_COLORS: Record<string, string> = {
  advisory: 'bg-blue-900/50 text-blue-300',
  'code-modification': 'bg-amber-900/50 text-amber-300',
  infrastructure: 'bg-red-900/50 text-red-300',
};

// Capability tier display names
const TIER_LABELS: Record<string, string> = {
  advisory: 'Advisory',
  'code-modification': 'Code Mod',
  infrastructure: 'Infra',
};

interface WorkflowProposal {
  playbookId: string;
  playbookName: string;
  playbookDescription?: string;
  rationale?: string;
  confidence?: number;
  agentRoles?: Array<{
    id: string;
    name: string;
    capabilityTier: string;
    stageCount: number;
  }>;
}

interface Props {
  ticket: WorkflowTicket;
  onApprove: () => Promise<void>;
  onSelectManually?: () => void;
}

export function WorkflowAssignmentPanel({ ticket, onApprove, onSelectManually }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sd = ticket.stateData as Record<string, unknown> | undefined;
  const proposal = sd?.workflowProposal as WorkflowProposal | undefined;
  const proposalStatus = sd?.workflowProposalStatus as string | undefined;

  // If ticket already has a playbook assigned, don't show the panel
  if (ticket.playbookRowId) {
    return null;
  }

  // Handle approval
  async function handleApprove() {
    setError(null);
    setSubmitting(true);
    try {
      await onApprove();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to approve workflow';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  // Loading state — proposal is being generated
  if (proposalStatus === 'pending' || (!proposal && proposalStatus !== 'failed')) {
    return (
      <div className="border border-gray-700 bg-gray-900 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <div>
            <h3 className="text-sm font-medium text-gray-300">Designing workflow...</h3>
            <p className="text-xs text-gray-500">
              Analyzing ticket to select the best workflow playbook
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Error state — proposal generation failed
  if (proposalStatus === 'failed' || (!proposal && proposalStatus === 'failed')) {
    return (
      <div className="border border-red-800/50 bg-red-950/30 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <h3 className="text-sm font-semibold text-red-300">Workflow selection failed</h3>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          Could not automatically select a workflow playbook for this ticket.
        </p>
        {onSelectManually && (
          <button
            onClick={onSelectManually}
            className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
          >
            Select playbook manually
          </button>
        )}
      </div>
    );
  }

  // No proposal available
  if (!proposal) {
    return null;
  }

  return (
    <div className="border border-blue-800/50 bg-blue-950/30 rounded-lg p-4 mb-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
        <h3 className="text-sm font-semibold text-blue-300">Workflow Playbook Selected</h3>
        {proposal.confidence != null && (
          <span className="text-[10px] px-1.5 py-0.5 bg-blue-900/50 text-blue-400 rounded ml-auto">
            {Math.round(proposal.confidence * 100)}% confidence
          </span>
        )}
      </div>

      {/* Playbook info */}
      <div className="mb-3">
        <h4 className="text-sm font-medium text-gray-200">{proposal.playbookName}</h4>
        {proposal.playbookDescription && (
          <p className="text-xs text-gray-400 mt-1">{proposal.playbookDescription}</p>
        )}
      </div>

      {/* Rationale */}
      {proposal.rationale && (
        <details className="mb-3">
          <summary className="text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-400">
            Selection Rationale
          </summary>
          <p className="mt-2 text-xs text-gray-400 bg-gray-900/50 rounded p-2">
            {proposal.rationale}
          </p>
        </details>
      )}

      {/* Agent roles */}
      {proposal.agentRoles && proposal.agentRoles.length > 0 && (
        <div className="mb-4">
          <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Agent Roles
          </h5>
          <div className="flex flex-wrap gap-2">
            {proposal.agentRoles.map((role) => (
              <div
                key={role.id}
                className="flex items-center gap-1.5 px-2 py-1 bg-gray-800 rounded text-xs"
              >
                <span className="text-gray-300">{role.name}</span>
                <span className={`px-1 py-0.5 rounded text-[10px] ${TIER_COLORS[role.capabilityTier] ?? 'bg-gray-700 text-gray-400'}`}>
                  {TIER_LABELS[role.capabilityTier] ?? role.capabilityTier}
                </span>
                {role.stageCount > 1 && (
                  <span className="text-gray-500">x{role.stageCount}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="mb-3 text-xs text-red-400 bg-red-950/50 rounded px-2 py-1">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleApprove}
          disabled={submitting}
          className="px-4 py-2 text-sm font-medium bg-green-800 hover:bg-green-700 text-green-200 rounded transition-colors disabled:opacity-50"
        >
          {submitting ? 'Starting...' : 'Approve & Start'}
        </button>
        {onSelectManually && (
          <button
            onClick={onSelectManually}
            disabled={submitting}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-300 transition-colors disabled:opacity-50"
          >
            Choose different playbook
          </button>
        )}
      </div>
    </div>
  );
}
