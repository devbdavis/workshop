/**
 * Tooltip component for state diagram nodes.
 */
import { type DiagramNode, type DiagramEdge } from './workflow-diagram-config';

interface DiagramTooltipProps {
  node: DiagramNode;
  edges: DiagramEdge[];
  position: { x: number; y: number };
}

function formatTypeName(type: string): string {
  switch (type) {
    case 'auto': return 'Auto-transition';
    case 'agent': return 'Agent-actionable';
    case 'human-gate': return 'Human Gate';
    case 'terminal': return 'Terminal';
    case 'waiting': return 'Waiting';
    default: return type;
  }
}

function formatLabel(label: string): string {
  return label
    .replace(/-/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function DiagramTooltip({ node, edges, position }: DiagramTooltipProps) {
  const outgoingEdges = edges.filter(e => e.from === node.id);

  return (
    <div
      className="absolute z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl px-3 py-2 pointer-events-none"
      style={{
        left: position.x + 16,
        top: position.y + 8,
        maxWidth: 280,
      }}
    >
      {/* Header */}
      <div className="font-medium text-gray-200 text-sm mb-1">
        {formatLabel(node.label)}
      </div>

      {/* Type badge */}
      <div className="text-xs text-gray-400 mb-2">
        {formatTypeName(node.type)}
      </div>

      {/* Agent info */}
      {node.agentRole && (
        <div className="text-xs text-blue-400 mb-2">
          Agent: {node.agentRole} ({node.agentCount} parallel)
        </div>
      )}

      {/* Transitions */}
      {outgoingEdges.length > 0 && (
        <div className="border-t border-gray-700 pt-2 mt-2">
          <div className="text-xs text-gray-500 mb-1">Transitions:</div>
          <ul className="text-xs text-gray-400 space-y-0.5">
            {outgoingEdges.map((edge, i) => (
              <li key={i} className="flex items-center gap-1">
                <span className={edge.backward ? 'text-red-400' : 'text-gray-400'}>
                  {edge.backward ? '<-' : '->'}
                </span>
                <span className="text-gray-300">{formatLabel(edge.to)}</span>
                <span className="text-gray-500">({edge.trigger})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
