/**
 * TemplateLibrary — Card-based display of all workflow templates.
 * Click a template to see its state diagram and agent role details.
 */
import { useEffect, useState, useMemo } from 'react';
import { StateDiagram } from './StateDiagram';

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

// Template type from server response (mirrors WorkflowTemplateRow)
interface WorkflowTemplate {
  rowId: string;
  id: string;
  version: number;
  name: string;
  description: string;
  ticketType: 'epic' | 'task';
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

type TicketTypeFilter = 'all' | 'epic' | 'task';

export function TemplateLibrary() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Filters
  const [ticketTypeFilter, setTicketTypeFilter] = useState<TicketTypeFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Load templates
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/workflow/templates');
        if (!res.ok) throw new Error('Failed to load templates');
        const data = await res.json();
        setTemplates(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load templates';
        setError(message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Filter templates
  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      if (ticketTypeFilter !== 'all' && t.ticketType !== ticketTypeFilter) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = t.name.toLowerCase().includes(query);
        const matchesDescription = t.description.toLowerCase().includes(query);
        const matchesTags = t.tags?.some((tag) => tag.toLowerCase().includes(query));
        if (!matchesName && !matchesDescription && !matchesTags) return false;
      }
      return true;
    });
  }, [templates, ticketTypeFilter, searchQuery]);

  const selected = selectedId ? templates.find((t) => t.rowId === selectedId) : null;

  if (loading) {
    return (
      <div className="p-8 text-gray-400 flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
        Loading templates...
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
        <h2 className="text-lg font-semibold text-gray-200">Workflow Templates</h2>
        <span className="text-sm text-gray-500">{filteredTemplates.length} templates</span>

        <div className="ml-auto flex items-center gap-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates..."
            className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-500 w-48 focus:outline-none focus:border-blue-500"
          />
          <div className="flex items-center gap-1 p-0.5 bg-gray-800 rounded">
            {(['all', 'epic', 'task'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setTicketTypeFilter(type)}
                className={`px-3 py-1 text-xs rounded transition-colors ${
                  ticketTypeFilter === type
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

      {filteredTemplates.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {templates.length === 0
            ? 'No workflow templates available.'
            : 'No templates match the current filters.'}
        </div>
      ) : (
        <div className="flex gap-6">
          {/* Template grid */}
          <div className={`grid gap-4 ${selected ? 'md:grid-cols-1 w-72 shrink-0' : 'md:grid-cols-2 lg:grid-cols-3 flex-1'}`}>
            {filteredTemplates.map((template) => (
              <TemplateCard
                key={template.rowId}
                template={template}
                isSelected={template.rowId === selectedId}
                onClick={() => setSelectedId(template.rowId === selectedId ? null : template.rowId)}
              />
            ))}
          </div>

          {/* Detail panel */}
          {selected && (
            <TemplateDetailPanel
              template={selected}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  isSelected,
  onClick,
}: {
  template: WorkflowTemplate;
  isSelected: boolean;
  onClick: () => void;
}) {
  const typeColor =
    template.ticketType === 'epic'
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
        <h3 className="text-sm font-medium text-gray-200">{template.name}</h3>
        <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${typeColor}`}>
          {template.ticketType}
        </span>
      </div>

      <p className="text-xs text-gray-500 line-clamp-2 mb-3">
        {template.description || 'No description'}
      </p>

      {template.tags && template.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {template.tags.slice(0, 5).map((tag) => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">
              {tag}
            </span>
          ))}
          {template.tags.length > 5 && (
            <span className="text-[10px] text-gray-500">+{template.tags.length - 5} more</span>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 text-[10px] text-gray-500">
        <span>v{template.version}</span>
        <span>{template.usageCount} uses</span>
        <span>{template.stageDefinitions.length} stages</span>
        {template.avgRating != null && <span>{template.avgRating.toFixed(1)} rating</span>}
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

function TemplateDetailPanel({
  template,
  onClose,
}: {
  template: WorkflowTemplate;
  onClose: () => void;
}) {
  const typeColor =
    template.ticketType === 'epic'
      ? 'bg-purple-900/50 text-purple-300 border-purple-800'
      : 'bg-cyan-900/50 text-cyan-300 border-cyan-800';

  // Collect unique semantic roles used in this template
  const usedRoles = useMemo(() => {
    const roles = new Set<string>();
    for (const stage of template.stageDefinitions) {
      roles.add(stage.semanticRole);
    }
    return [...roles];
  }, [template.stageDefinitions]);

  // Collect unique agent roles referenced
  const agentRoles = useMemo(() => {
    const roles: Array<{ state: string; roleId: string }> = [];
    for (const stage of template.stageDefinitions) {
      if (stage.agentRoleId) {
        roles.push({ state: stage.state, roleId: stage.agentRoleId });
      }
    }
    return roles;
  }, [template.stageDefinitions]);

  return (
    <div className="flex-1 border border-gray-800 bg-gray-900 rounded-lg overflow-hidden min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-200">{template.name}</h3>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${typeColor}`}>
            {template.ticketType}
          </span>
          <span className="text-[10px] text-gray-500">v{template.version}</span>
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
        <StateDiagram stages={template.stageDefinitions} />
      </div>

      {/* Details */}
      <div className="px-5 py-4 space-y-4 text-xs">
        {/* Description */}
        {template.description && (
          <div>
            <h4 className="text-gray-400 font-medium mb-1">Description</h4>
            <p className="text-gray-300">{template.description}</p>
          </div>
        )}

        {/* Stage summary table */}
        <div>
          <h4 className="text-gray-400 font-medium mb-2">Stages ({template.stageDefinitions.length})</h4>
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
                {template.stageDefinitions.map((stage) => {
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
            <h4 className="text-gray-400 font-medium mb-1">Agent Roles</h4>
            <div className="flex flex-wrap gap-2">
              {agentRoles.map(({ state, roleId }) => (
                <span
                  key={state}
                  className="px-2 py-1 bg-blue-900/30 text-blue-300 border border-blue-800/50 rounded font-mono"
                >
                  {roleId}
                  <span className="text-blue-500 ml-1.5">&rarr; {state}</span>
                </span>
              ))}
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
        {(template.tags?.length || template.matchCriteria) && (
          <div className="flex gap-6">
            {template.tags && template.tags.length > 0 && (
              <div>
                <h4 className="text-gray-400 font-medium mb-1">Tags</h4>
                <div className="flex flex-wrap gap-1">
                  {template.tags.map((tag) => (
                    <span key={tag} className="px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {template.matchCriteria?.keywords && (
              <div>
                <h4 className="text-gray-400 font-medium mb-1">Keywords</h4>
                <div className="flex flex-wrap gap-1">
                  {template.matchCriteria.keywords.map((kw) => (
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
