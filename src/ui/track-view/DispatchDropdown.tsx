import { useState } from 'react';
import type { Agent, SessionProvider, AgentSource } from '@foundation/types';

const PROVIDER_OPTIONS: { value: SessionProvider; label: string; color: string }[] = [
  { value: 'claude', label: 'Claude', color: 'bg-orange-400' },
  { value: 'codex', label: 'Codex', color: 'bg-emerald-400' },
];

const SOURCE_LABELS: Record<AgentSource, string> = {
  global: 'Global',
  project: 'Project',
  workshop: 'Workshop',
};

interface Props {
  agents: Agent[];
  onSelect: (agentId?: string, provider?: SessionProvider) => void;
  onClose: () => void;
  /** Position the dropdown above the button instead of below */
  popUp?: boolean;
}

export function DispatchDropdown({ agents, onSelect, onClose, popUp }: Props) {
  const [provider, setProvider] = useState<SessionProvider>('claude');
  const [expandedGroups, setExpandedGroups] = useState<Set<AgentSource>>(new Set(['workshop']));

  const bySource = agents.reduce(
    (acc, agent) => {
      acc[agent.source].push(agent);
      return acc;
    },
    { global: [], project: [], workshop: [] } as Record<AgentSource, Agent[]>,
  );

  function toggleGroup(source: AgentSource) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }

  const groupOrder: AgentSource[] = ['workshop', 'project', 'global'];

  return (
    <div className={`absolute left-0 z-10 bg-gray-800 border border-gray-700 rounded-lg shadow-lg min-w-[200px] ${popUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
      {/* Provider toggle */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-700">
        <span className="text-[10px] text-gray-500 mr-1">Run as:</span>
        {PROVIDER_OPTIONS.map((p) => (
          <button
            key={p.value}
            onClick={() => setProvider(p.value)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors ${
              provider === p.value
                ? 'bg-gray-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${p.color}`} />
            {p.label}
          </button>
        ))}
      </div>

      {/* Default option */}
      <button
        onClick={() => onSelect(undefined, provider)}
        className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
      >
        Default (no agent)
      </button>

      {/* Grouped agents */}
      {groupOrder.map((source) => {
        const group = bySource[source];
        if (group.length === 0) return null;
        const isExpanded = expandedGroups.has(source);
        return (
          <div key={source}>
            <button
              onClick={() => toggleGroup(source)}
              className="w-full flex items-center justify-between px-3 py-1 text-[10px] text-gray-500 hover:text-gray-300 border-t border-gray-700"
            >
              <span>{SOURCE_LABELS[source]} ({group.length})</span>
              <svg
                className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
            {isExpanded && group.map((agent) => (
              <button
                key={agent.id}
                onClick={() => onSelect(agent.id, provider)}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 pl-5"
              >
                <span className="font-medium">{agent.name}</span>
              </button>
            ))}
          </div>
        );
      })}

      {/* Cancel */}
      <div className="border-t border-gray-700" />
      <button
        onClick={onClose}
        className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-700"
      >
        Cancel
      </button>
    </div>
  );
}
