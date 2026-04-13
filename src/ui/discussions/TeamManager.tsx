import { useState } from 'react';
import type { DiscussionTeam, ConsensusRule } from '@foundation/discussion-types';
import type { Agent } from '@foundation/types';

type ProviderType = 'claude' | 'codex' | 'gemini' | 'cursor';

function resolveAgentProvider(agent: Agent): ProviderType {
  // Check explicit provider field first
  if (agent.provider) return agent.provider;
  const model = (agent.model || '').toLowerCase();
  if (model.startsWith('gemini')) return 'gemini';
  if (model.startsWith('codex') || model === 'o1' || model === 'o3' || model === 'o4-mini') return 'codex';
  return 'claude';
}

const PROVIDER_BADGES: Record<ProviderType, { bg: string; label: string }> = {
  claude: { bg: 'bg-orange-900/60 text-orange-300', label: 'Claude' },
  codex: { bg: 'bg-green-900/60 text-green-300', label: 'Codex' },
  gemini: { bg: 'bg-blue-900/60 text-blue-300', label: 'Gemini' },
  cursor: { bg: 'bg-violet-900/60 text-violet-300', label: 'Cursor' },
};

interface CreateTeamData {
  name: string;
  description?: string;
  consensusRule: ConsensusRule;
  memberAgentIds: string[];
}

interface TeamManagerProps {
  teams: DiscussionTeam[];
  agents: Agent[];
  onCreateTeam: (data: CreateTeamData) => void;
  onUpdateTeam: (id: string, data: CreateTeamData) => void;
  onDeleteTeam: (id: string) => void;
  onClose: () => void;
}

type ConsensusType = ConsensusRule['type'];

const CONSENSUS_BADGES: Record<ConsensusType, string> = {
  unanimous: 'bg-purple-900/60 text-purple-300',
  majority: 'bg-blue-900/60 text-blue-300',
  quorum: 'bg-amber-900/60 text-amber-300',
};

function consensusLabel(rule: ConsensusRule): string {
  switch (rule.type) {
    case 'unanimous': return 'Unanimous';
    case 'majority': return `Majority (${Math.round(rule.threshold * 100)}%)`;
    case 'quorum': return `Quorum (${rule.minVotes} votes)`;
  }
}

function buildRule(type: ConsensusType, threshold: number, minVotes: number): ConsensusRule {
  switch (type) {
    case 'unanimous': return { type: 'unanimous' };
    case 'majority': return { type: 'majority', threshold };
    case 'quorum': return { type: 'quorum', minVotes };
  }
}

export function TeamManager({ teams, agents, onCreateTeam, onUpdateTeam, onDeleteTeam, onClose }: TeamManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
          <h2 className="text-sm font-semibold">Manage Teams</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {teams.length === 0 && !showCreate && (
            <p className="text-xs text-gray-500 text-center py-6">No teams yet. Create one to get started.</p>
          )}
          {teams.map((team) => (
            editingId === team.id ? (
              <TeamForm
                key={team.id}
                agents={agents}
                initial={team}
                onSave={(data) => { onUpdateTeam(team.id, data); setEditingId(null); }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <TeamCard
                key={team.id}
                team={team}
                onEdit={() => { setEditingId(team.id); setShowCreate(false); }}
                onDelete={() => onDeleteTeam(team.id)}
              />
            )
          ))}
          {showCreate && (
            <TeamForm
              agents={agents}
              onSave={(data) => { onCreateTeam(data); setShowCreate(false); }}
              onCancel={() => setShowCreate(false)}
            />
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800 shrink-0">
          <button
            onClick={() => { setShowCreate(true); setEditingId(null); }}
            disabled={showCreate}
            className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded transition-colors"
          >
            + New Team
          </button>
          <button onClick={onClose} className="px-4 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function TeamCard({ team, onEdit, onDelete }: {
  team: DiscussionTeam; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{team.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${CONSENSUS_BADGES[team.consensusRule.type]}`}>
              {consensusLabel(team.consensusRule)}
            </span>
          </div>
          {team.description && <p className="text-xs text-gray-400 mt-1">{team.description}</p>}
          <p className="text-[10px] text-gray-500 mt-1">
            {team.memberAgentIds.length} member{team.memberAgentIds.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} className="text-[10px] px-2 py-1 text-gray-500 hover:text-gray-200 transition-colors">
            Edit
          </button>
          <button onClick={onDelete} className="text-[10px] px-2 py-1 text-gray-600 hover:text-red-400 transition-colors">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function TeamForm({ agents, initial, onSave, onCancel }: {
  agents: Agent[]; initial?: DiscussionTeam; onSave: (data: CreateTeamData) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [consensusType, setConsensusType] = useState<ConsensusType>(initial?.consensusRule.type ?? 'unanimous');
  const [threshold, setThreshold] = useState(
    initial?.consensusRule.type === 'majority' ? initial.consensusRule.threshold : 0.5,
  );
  const [minVotes, setMinVotes] = useState(
    initial?.consensusRule.type === 'quorum' ? initial.consensusRule.minVotes : 1,
  );
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(
    new Set(initial?.memberAgentIds ?? []),
  );

  function toggleAgent(id: string) {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleSubmit() {
    if (!name.trim() || selectedAgentIds.size === 0) return;
    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      consensusRule: buildRule(consensusType, threshold, minVotes),
      memberAgentIds: [...selectedAgentIds],
    });
  }

  const canSubmit = name.trim().length > 0 && selectedAgentIds.size > 0;

  return (
    <div className="bg-gray-800/50 border border-blue-800/50 rounded p-4 space-y-3">
      <h3 className="text-xs font-semibold text-gray-300">{initial ? 'Edit Team' : 'New Team'}</h3>

      <Field label="Name">
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Backend Reviewers"
          className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm" autoFocus
        />
      </Field>

      <Field label="Description" optional>
        <input
          value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="What this team is responsible for"
          className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm"
        />
      </Field>

      <Field label="Consensus Rule">
        <div className="space-y-2">
          <div className="flex gap-1">
            {(['unanimous', 'majority', 'quorum'] as const).map((t) => (
              <button
                key={t} onClick={() => setConsensusType(t)}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  consensusType === t ? CONSENSUS_BADGES[t] : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          {consensusType === 'majority' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Threshold</span>
              <input type="number" min={0.5} max={1.0} step={0.1} value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value) || 0.5)}
                className="w-20 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-center" />
              <span className="text-[10px] text-gray-500">({Math.round(threshold * 100)}%)</span>
            </div>
          )}
          {consensusType === 'quorum' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Minimum votes</span>
              <input type="number" min={1} value={minVotes}
                onChange={(e) => setMinVotes(parseInt(e.target.value, 10) || 1)}
                className="w-20 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-center" />
            </div>
          )}
        </div>
      </Field>

      <Field label="Members">
        <div className="space-y-1 max-h-40 overflow-y-auto">
          {agents.length === 0 && <p className="text-[10px] text-gray-500">No agents available.</p>}
          {agents.map((agent) => (
            <label key={agent.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-700/50 cursor-pointer">
              <input type="checkbox" checked={selectedAgentIds.has(agent.id)}
                onChange={() => toggleAgent(agent.id)} className="accent-blue-500" />
              <span className="text-xs flex-1 truncate">{agent.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 shrink-0">{agent.source}</span>
              {(() => {
                const p = resolveAgentProvider(agent);
                const badge = PROVIDER_BADGES[p];
                return <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${badge.bg}`}>{badge.label}</span>;
              })()}
            </label>
          ))}
        </div>
        {selectedAgentIds.size === 0 && (
          <p className="text-[10px] text-red-400/70 mt-1">At least 1 agent required.</p>
        )}
      </Field>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-4 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors">
          Cancel
        </button>
        <button onClick={handleSubmit} disabled={!canSubmit}
          className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded transition-colors">
          {initial ? 'Save Changes' : 'Create Team'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, optional, children }: {
  label: string; optional?: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">
        {label}{optional && <span className="text-gray-600 ml-1">(optional)</span>}
      </label>
      {children}
    </div>
  );
}
