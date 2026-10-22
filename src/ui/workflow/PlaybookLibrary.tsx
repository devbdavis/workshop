/**
 * PlaybookLibrary — Card-based display of all workflow playbooks.
 * Click a playbook to see its state diagram and agent role details.
 */
import { useEffect, useState, useMemo } from 'react';
import { StateDiagram } from './StateDiagram';

// Agent role prompt block
interface PromptBlock {
  preamble: string;
  toolAccessTier: string;
  constraints: string[];
  completionInstructions: string;
}

// Agent role from /api/workflow/agent-roles
interface AgentRole {
  id: string;
  name: string;
  description: string;
  promptBlock: PromptBlock;
  capabilityTier: string;
  reusable: boolean;
  usageCount: number;
}

// Stage definition (mirrors domain type)
interface StageDefinition {
  state: string;
  semanticRole: string;
  agentActionable: boolean;
  humanGate: boolean;
  agentRoleId?: string;
  agentCount?: number;
  validTransitions: Array<{
    to: string;
    trigger: string;
    condition?: string;
  }>;
  promptOverride?: string;
}

// Playbook type from server response (mirrors PlaybookRow)
interface Playbook {
  rowId: string;
  id: string;
  version: number;
  name: string;
  description: string;
  issueType: 'epic' | 'task';
  stageDefinitions: StageDefinition[];
  tags?: string[];
  matchCriteria?: {
    keywords?: string[];
    complexity?: string;
    domains?: string[];
  };
  promptOverrides?: Record<string, string>;
  usageCount: number;
  avgRating?: number;
  isLatest: boolean;
  createdAt: string;
}

type IssueTypeFilter = 'all' | 'epic' | 'task';

export function PlaybookLibrary() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Filters
  const [issueTypeFilter, setIssueTypeFilter] = useState<IssueTypeFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Load playbooks
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/workflow/playbooks');
        if (!res.ok) throw new Error('Failed to load playbooks');
        const data = await res.json();
        setPlaybooks(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load playbooks';
        setError(message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Filter playbooks
  const filteredPlaybooks = useMemo(() => {
    return playbooks.filter((t) => {
      if (issueTypeFilter !== 'all' && t.issueType !== issueTypeFilter) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = t.name.toLowerCase().includes(query);
        const matchesDescription = t.description.toLowerCase().includes(query);
        const matchesTags = t.tags?.some((tag) => tag.toLowerCase().includes(query));
        if (!matchesName && !matchesDescription && !matchesTags) return false;
      }
      return true;
    });
  }, [playbooks, issueTypeFilter, searchQuery]);

  const selected = selectedId ? playbooks.find((t) => t.rowId === selectedId) : null;

  if (loading) {
    return (
      <div className="p-8 text-gray-400 flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
        Loading playbooks...
      </div>
    );
  }

  if (error) {
    return <div className="p-8 text-red-400">{error}</div>;
  }

  return (
    <div className="p-6 max-w-7xl">
      {/* Header and filters */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-200">Workflow Playbooks</h2>
        <span className="text-sm text-gray-500">{filteredPlaybooks.length} playbooks</span>

        <div className="ml-auto flex items-center gap-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search playbooks..."
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-500 w-48 focus:outline-none focus:border-blue-500"
          />
          <div className="flex items-center gap-1 p-0.5 bg-gray-800 rounded">
            {(['all', 'epic', 'task'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setIssueTypeFilter(type)}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  issueTypeFilter === type
                    ? 'bg-gray-700 text-gray-200'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filteredPlaybooks.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {playbooks.length === 0
            ? 'No workflow playbooks available.'
            : 'No playbooks match the current filters.'}
        </div>
      ) : (
        <div className="flex gap-6">
          {/* Playbook grid */}
          <div className={`grid gap-4 ${selected ? 'md:grid-cols-1 w-72 shrink-0' : 'md:grid-cols-2 lg:grid-cols-3 flex-1'}`}>
            {filteredPlaybooks.map((playbook) => (
              <PlaybookCard
                key={playbook.rowId}
                playbook={playbook}
                isSelected={playbook.rowId === selectedId}
                onClick={() => setSelectedId(playbook.rowId === selectedId ? null : playbook.rowId)}
              />
            ))}
          </div>

          {/* Detail panel */}
          {selected && (
            <PlaybookDetailPanel
              playbook={selected}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PlaybookCard({
  playbook,
  isSelected,
  onClick,
}: {
  playbook: Playbook;
  isSelected: boolean;
  onClick: () => void;
}) {
  const typeColor =
    playbook.issueType === 'epic'
      ? 'bg-purple-900/50 text-purple-300'
      : 'bg-cyan-900/50 text-cyan-300';

  return (
    <button
      onClick={onClick}
      className={`border rounded-lg p-4 text-left transition-colors w-full ${
        isSelected
          ? 'border-blue-500 bg-blue-950/30'
          : 'border-gray-800 bg-gray-900 hover:border-gray-700'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-medium text-gray-200">{playbook.name}</h3>
        <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${typeColor}`}>
          {playbook.issueType}
        </span>
      </div>

      <p className="text-xs text-gray-500 line-clamp-2 mb-3">
        {playbook.description || 'No description'}
      </p>

      {playbook.tags && playbook.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {playbook.tags.slice(0, 5).map((tag) => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">
              {tag}
            </span>
          ))}
          {playbook.tags.length > 5 && (
            <span className="text-[10px] text-gray-500">+{playbook.tags.length - 5} more</span>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 text-[10px] text-gray-500">
        <span>v{playbook.version}</span>
        <span>{playbook.usageCount} uses</span>
        <span>{playbook.stageDefinitions.length} stages</span>
        {playbook.avgRating != null && <span>{playbook.avgRating.toFixed(1)} rating</span>}
      </div>
    </button>
  );
}

// Semantic role descriptions for the legend
const ROLE_INFO: Record<string, { label: string; color: string; description: string }> = {
  entry:        { label: 'Entry',      color: 'text-blue-400',   description: 'Workflow start' },
  processing:   { label: 'Processing', color: 'text-blue-400',   description: 'Agent or system working' },
  'human-gate': { label: 'Human Gate', color: 'text-amber-400',  description: 'Requires human decision' },
  terminal:     { label: 'Terminal',   color: 'text-green-400',  description: 'End state' },
  error:        { label: 'Error',      color: 'text-red-400',    description: 'Failure state' },
  waiting:      { label: 'Waiting',    color: 'text-purple-400', description: 'Blocked on dependency' },
};

function PlaybookDetailPanel({
  playbook,
  onClose,
}: {
  playbook: Playbook;
  onClose: () => void;
}) {
  const typeColor =
    playbook.issueType === 'epic'
      ? 'bg-sky-900/50 text-sky-300 border-sky-800'
      : 'bg-teal-900/50 text-teal-300 border-teal-800';

  // Fetch agent roles from the API
  const [agentRoleMap, setAgentRoleMap] = useState<Map<string, AgentRole>>(new Map());
  const [expandedRoleId, setExpandedRoleId] = useState<string | null>(null);

  useEffect(() => {
    async function loadRoles() {
      try {
        const res = await fetch('/api/workflow/agent-roles');
        if (!res.ok) return;
        const data: AgentRole[] = await res.json();
        setAgentRoleMap(new Map(data.map((r) => [r.id, r])));
      } catch {
        // Non-fatal — role details simply won't appear
      }
    }
    loadRoles();
  }, []);

  // Collect unique semantic roles used in this playbook
  const usedRoles = useMemo(() => {
    const roles = new Set<string>();
    for (const stage of playbook.stageDefinitions) {
      roles.add(stage.semanticRole);
    }
    return [...roles];
  }, [playbook.stageDefinitions]);

  // Collect unique agent role IDs with all stages they appear in
  const agentRoles = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const stage of playbook.stageDefinitions) {
      if (stage.agentRoleId) {
        const existing = map.get(stage.agentRoleId) ?? [];
        existing.push(stage.state);
        map.set(stage.agentRoleId, existing);
      }
    }
    return [...map.entries()].map(([roleId, states]) => ({ roleId, states }));
  }, [playbook.stageDefinitions]);

  return (
    <div className="flex-1 border border-gray-800 bg-gray-900 rounded-lg overflow-hidden min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-200">{playbook.name}</h3>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${typeColor}`}>
            {playbook.issueType}
          </span>
          <span className="text-[10px] text-gray-500">v{playbook.version}</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 text-lg leading-none px-1"
          title="Close"
        >
          &times;
        </button>
      </div>

      {/* Diagram */}
      <div className="px-5 py-4 border-b border-gray-800 bg-gray-950/50">
        <StateDiagram stages={playbook.stageDefinitions} />
      </div>

      {/* Details */}
      <div className="px-5 py-4 space-y-4 text-xs">
        {/* Description */}
        {playbook.description && (
          <div>
            <h4 className="text-gray-400 font-medium mb-1">Description</h4>
            <p className="text-gray-300">{playbook.description}</p>
          </div>
        )}

        {/* Stage summary table */}
        <div>
          <h4 className="text-gray-400 font-medium mb-2">Stages ({playbook.stageDefinitions.length})</h4>
          <div className="border border-gray-800 rounded overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-gray-800/50 text-gray-400">
                  <th className="text-left px-3 py-1.5 font-medium">State</th>
                  <th className="text-left px-3 py-1.5 font-medium">Role</th>
                  <th className="text-left px-3 py-1.5 font-medium">Agent</th>
                  <th className="text-left px-3 py-1.5 font-medium">Transitions</th>
                </tr>
              </thead>
              <tbody>
                {playbook.stageDefinitions.map((stage) => {
                  const roleInfo = ROLE_INFO[stage.semanticRole];
                  return (
                    <tr key={stage.state} className="border-t border-gray-800/50">
                      <td className="px-3 py-1.5 text-gray-200 font-mono">{stage.state}</td>
                      <td className={`px-3 py-1.5 ${roleInfo?.color ?? 'text-gray-400'}`}>
                        {stage.humanGate ? '\u{1F464} ' : stage.agentActionable ? '\u{1F916} ' : ''}
                        {roleInfo?.label ?? stage.semanticRole}
                      </td>
                      <td className="px-3 py-1.5 text-gray-400 font-mono">
                        {stage.agentRoleId ?? '\u2014'}
                      </td>
                      <td className="px-3 py-1.5 text-gray-500">
                        {stage.validTransitions.length === 0
                          ? '\u2014'
                          : stage.validTransitions
                              .map((t) => `${t.to} (${t.trigger})`)
                              .join(', ')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Agent roles */}
        {agentRoles.length > 0 && (
          <div>
            <h4 className="text-gray-400 font-medium mb-2">Agent Roles</h4>
            <div className="space-y-2">
              {agentRoles.map(({ roleId, states }) => {
                const role = agentRoleMap.get(roleId);
                const isExpanded = expandedRoleId === roleId;
                return (
                  <div
                    key={roleId}
                    className="border border-gray-800 rounded overflow-hidden"
                  >
                    {/* Role header — always visible, clickable */}
                    <button
                      onClick={() => setExpandedRoleId(isExpanded ? null : roleId)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-gray-800/40 hover:bg-gray-800/70 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-blue-300 font-mono text-[11px] shrink-0">{roleId}</span>
                        <div className="flex gap-1 flex-wrap">
                          {states.map((s) => (
                            <span key={s} className="text-[10px] px-1.5 py-0.5 bg-blue-900/30 text-blue-400 border border-blue-800/40 rounded">
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                      <span className="text-gray-500 text-[10px] shrink-0 ml-2">
                        {role ? (isExpanded ? '▲ hide' : '▼ details') : '—'}
                      </span>
                    </button>

                    {/* Expanded prompt block */}
                    {isExpanded && role && (
                      <div className="px-3 py-3 space-y-3 bg-gray-950/60 border-t border-gray-800">
                        {/* Description */}
                        {role.description && (
                          <p className="text-[11px] text-gray-400 leading-relaxed">{role.description}</p>
                        )}
                        {/* Capability tier */}
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-500">Capability tier:</span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-300 rounded font-mono">
                            {role.capabilityTier}
                          </span>
                        </div>

                        {/* Preamble */}
                        {role.promptBlock.preamble && (
                          <div>
                            <div className="text-[10px] text-gray-500 mb-1 font-medium uppercase tracking-wide">Preamble</div>
                            <pre className="text-[11px] text-gray-300 whitespace-pre-wrap font-sans leading-relaxed bg-gray-900/50 rounded px-2 py-2 border border-gray-800/50">
                              {role.promptBlock.preamble}
                            </pre>
                          </div>
                        )}

                        {/* Constraints */}
                        {role.promptBlock.constraints.length > 0 && (
                          <div>
                            <div className="text-[10px] text-gray-500 mb-1 font-medium uppercase tracking-wide">Constraints</div>
                            <ul className="space-y-1">
                              {role.promptBlock.constraints.map((c, i) => (
                                <li key={i} className="flex gap-2 text-[11px] text-gray-300">
                                  <span className="text-gray-600 shrink-0">·</span>
                                  <span>{c}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Completion instructions */}
                        {role.promptBlock.completionInstructions && (
                          <div>
                            <div className="text-[10px] text-gray-500 mb-1 font-medium uppercase tracking-wide">Completion Instructions</div>
                            <pre className="text-[11px] text-gray-300 whitespace-pre-wrap font-sans leading-relaxed bg-gray-900/50 rounded px-2 py-2 border border-gray-800/50">
                              {role.promptBlock.completionInstructions}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Legend */}
        <div>
          <h4 className="text-gray-400 font-medium mb-1">Legend</h4>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {usedRoles.map((role) => {
              const info = ROLE_INFO[role];
              if (!info) return null;
              return (
                <span key={role} className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-sm ${info.color.replace('text-', 'bg-')}`} />
                  <span className="text-gray-400">{info.label}</span>
                </span>
              );
            })}
            <span className="flex items-center gap-1.5">
              <span className="text-[10px]">{'\u{1F916}'}</span>
              <span className="text-gray-400">Agent</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-[10px]">{'\u{1F464}'}</span>
              <span className="text-gray-400">Human</span>
            </span>
          </div>
        </div>

        {/* Match criteria & tags */}
        {(playbook.tags?.length || playbook.matchCriteria) && (
          <div className="flex gap-6">
            {playbook.tags && playbook.tags.length > 0 && (
              <div>
                <h4 className="text-gray-400 font-medium mb-1">Tags</h4>
                <div className="flex flex-wrap gap-1">
                  {playbook.tags.map((tag) => (
                    <span key={tag} className="px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {playbook.matchCriteria?.keywords && (
              <div>
                <h4 className="text-gray-400 font-medium mb-1">Keywords</h4>
                <div className="flex flex-wrap gap-1">
                  {playbook.matchCriteria.keywords.map((kw) => (
                    <span key={kw} className="px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
