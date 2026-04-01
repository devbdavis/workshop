import { useState } from 'react';
import type { Agent, SessionProvider } from '@foundation/types';

export interface DispatchOptions {
  agentId?: string;
  provider?: SessionProvider;
  dangerouslySkipPermissions?: boolean;
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
  /** Track's configured default agent, shown as the top option */
  defaultAgent?: Agent;
}

export function DispatchDropdown({ agents, onSelect, onClose, popUp, defaultAgent }: Props) {
  const [provider, setProvider] = useState<SessionProvider>('claude');
  const [skipPermissions, setSkipPermissions] = useState(false);

  function handleSelect(agentId?: string) {
    onSelect({
      agentId,
      provider,
      dangerouslySkipPermissions: skipPermissions || undefined,
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

      {/* Skip permissions toggle */}
      <label className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 cursor-pointer hover:bg-gray-700/50">
        <input
          type="checkbox"
          checked={skipPermissions}
          onChange={(e) => setSkipPermissions(e.target.checked)}
          className="rounded border-gray-600 bg-gray-800 w-3 h-3"
        />
        <span className={`text-[10px] flex items-center gap-1 ${skipPermissions ? 'text-red-400' : 'text-gray-500'}`}>
          <svg className="w-3 h-3 text-red-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          Skip permissions
        </span>
      </label>

      {/* Default option — shows track default agent if configured */}
      <button
        onClick={() => handleSelect(undefined)}
        className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-700 border-b border-gray-700"
      >
        {defaultAgent ? (
          <span className="text-gray-300">
            Track default:{' '}
            <span className="font-medium text-blue-300">{defaultAgent.name}</span>
          </span>
        ) : (
          <span className="text-gray-500">No default agent</span>
        )}
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
