import { useState } from 'react';
import type { Agent } from '@foundation/types';

interface Props {
  agent: Agent;
  onEdit: () => void;
  onDelete: () => void;
  onImprove: () => void;
}

const SOURCE_STYLES = {
  global: 'bg-gray-700 text-gray-300',
  project: 'bg-blue-900 text-blue-300',
  workshop: 'bg-green-900 text-green-300',
};

const SOURCE_LABELS = {
  global: 'Global',
  project: 'Project',
  workshop: 'Workshop',
};

export function AgentCard({ agent, onEdit, onDelete, onImprove }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isEditable = agent.source === 'global' || agent.source === 'workshop';

  // Truncate system prompt for preview
  const promptPreview =
    agent.systemPrompt.length > 100 ? agent.systemPrompt.slice(0, 100) + '...' : agent.systemPrompt;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-200">{agent.name}</h3>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${SOURCE_STYLES[agent.source]}`}>
              {SOURCE_LABELS[agent.source]}
            </span>
            {agent.model && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900 text-purple-300">
                {agent.model}
              </span>
            )}
            {agent.color && (
              <span
                className="w-3 h-3 rounded-full border border-gray-600"
                style={{ backgroundColor: agent.color }}
                title={`Color: ${agent.color}`}
              />
            )}
          </div>
          {agent.description && (
            <p className="text-xs text-gray-400 mt-1">{agent.description}</p>
          )}
          {agent.filePath && (
            <p className="text-[10px] text-gray-500 mt-1 font-mono">{agent.filePath}</p>
          )}
          {(agent.allowedTools || agent.maxTurns) && (
            <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500">
              {agent.allowedTools && agent.allowedTools.length > 0 && (
                <span>Tools: {agent.allowedTools.join(', ')}</span>
              )}
              {agent.maxTurns && <span>Max turns: {agent.maxTurns}</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 ml-3 shrink-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            {expanded ? 'Collapse' : 'Preview'}
          </button>
          {isEditable && (
            <>
              <button onClick={onImprove} className="text-xs text-gray-400 hover:text-blue-300">
                Improve
              </button>
              <button onClick={onEdit} className="text-xs text-blue-400 hover:text-blue-300">
                Edit
              </button>
              <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-400">
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      {!expanded && (
        <p className="text-xs text-gray-500 mt-2 line-clamp-2">{promptPreview}</p>
      )}
      {expanded && (
        <pre className="mt-3 p-3 bg-gray-900 rounded text-xs text-gray-300 whitespace-pre-wrap overflow-x-auto max-h-60 overflow-y-auto">
          {agent.systemPrompt}
        </pre>
      )}
    </div>
  );
}
