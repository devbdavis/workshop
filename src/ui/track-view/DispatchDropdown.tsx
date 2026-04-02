import { useState } from 'react';
import type { Agent, SessionProvider } from '@foundation/types';

export interface DispatchOptions {
  agentId?: string;
  provider?: SessionProvider;
}

const PROVIDER_OPTIONS: { value: SessionProvider; label: string; color: string }[] = [
  { value: 'claude', label: 'Claude', color: 'bg-orange-400' },
  { value: 'codex', label: 'Codex', color: 'bg-emerald-400' },
];

interface Props {
  agents: Agent[];
  onSelect: (options: DispatchOptions) => void;
  onClose: () => void;
  /** Position the dropdown above the button instead of below */
  popUp?: boolean;
}

export function DispatchDropdown({ agents, onSelect, onClose, popUp }: Props) {
  const [provider, setProvider] = useState<SessionProvider>('claude');

  function handleSelect(agentId?: string) {
    onSelect({
      agentId,
      provider,
    });
  }

  const sorted = [...agents].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className={`absolute left-0 z-10 bg-gray-800 border border-gray-700 rounded-lg shadow-lg min-w-[220px] ${popUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
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
        onClick={() => handleSelect(undefined)}
        className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 border-b border-gray-700"
      >
        Default (no agent)
      </button>

      {/* Flat agent list */}
      {sorted.map((agent) => (
        <button
          key={agent.id}
          onClick={() => handleSelect(agent.id)}
          className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
        >
          <span className="font-medium">{agent.name}</span>
        </button>
      ))}

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
