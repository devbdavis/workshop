import { useState, useEffect, useRef } from 'react';
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
  const [dangerouslySkipPermissions, setDangerouslySkipPermissions] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  function handleSelect(agentId?: string) {
    onSelect({
      agentId,
      provider,
      dangerouslySkipPermissions,
    });
  }

  const sorted = [...agents].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div ref={ref} className={`absolute left-0 z-10 bg-gray-800 border border-gray-700 rounded-lg shadow-lg min-w-[220px] ${popUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
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

      {/* Dangerous mode toggle */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-700">
        <input
          type="checkbox"
          id="dispatch-dangerous"
          checked={dangerouslySkipPermissions}
          onChange={(e) => setDangerouslySkipPermissions(e.target.checked)}
          className="rounded border-gray-600 bg-gray-800"
        />
        <label htmlFor="dispatch-dangerous" className="text-[10px] text-gray-400 cursor-pointer select-none">
          Dangerous mode (skip permission prompts)
        </label>
      </div>

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
