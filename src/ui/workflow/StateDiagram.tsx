/**
 * StateDiagram — renders a workflow's stage definitions as an interactive
 * state diagram. Accepts dynamic stages as props (no hardcoded templates).
 */
import { useMemo } from 'react';

// Mirrors the StageDefinition type from the workflow schemas
interface StageDefinition {
  state: string;
  semanticRole: string;
  agentActionable: boolean;
  humanGate: boolean;
  agentRoleId?: string;
  validTransitions: Array<{
    to: string;
    trigger: string;
    condition?: string;
  }>;
  promptOverride?: string;
}

interface WorkflowTransition {
  fromState: string;
  toState: string;
  createdAt: string;
}

interface StateDiagramProps {
  stages: StageDefinition[];
  currentState?: string;
  transitions?: WorkflowTransition[];
}

// Layout constants
const NODE_WIDTH = 140;
const NODE_HEIGHT = 44;
const X_SPACING = 180;
const Y_SPACING = 80;
const PADDING = 40;

// Semantic role colors — matches WorkflowStateIndicator palette
const ROLE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  entry:      { bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd' },
  processing: { bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd' },
  'human-gate': { bg: '#4a3728', border: '#f59e0b', text: '#fcd34d' },
  terminal:   { bg: '#1a3a2a', border: '#22c55e', text: '#86efac' },
  error:      { bg: '#3b1c1c', border: '#ef4444', text: '#fca5a5' },
  waiting:    { bg: '#2e1a4a', border: '#a855f7', text: '#d8b4fe' },
};

const DEFAULT_COLOR = { bg: '#1f2937', border: '#6b7280', text: '#d1d5db' };

// Trigger label abbreviations for edge annotations
const TRIGGER_LABELS: Record<string, string> = {
  'agent-complete': 'agent',
  'human-approve': 'approve',
  'human-reject': 'reject',
  auto: 'auto',
  'all-deps-resolved': 'deps ok',
  'all-tasks-done': 'tasks done',
  manual: 'manual',
  'execution-complete': 'exec ok',
  'execution-failed': 'exec fail',
};

/**
 * Assign (col, row) positions to each stage using a BFS layering approach.
 */
function layoutStages(
  stages: StageDefinition[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (stages.length === 0) return positions;

  // BFS from entry to assign column layers
  const layers = new Map<string, number>();
  const queue: string[] = [stages[0].state];
  layers.set(stages[0].state, 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLayer = layers.get(current)!;
    const stage = stages.find((s) => s.state === current);
    if (!stage) continue;

    for (const t of stage.validTransitions) {
      if (!layers.has(t.to)) {
        layers.set(t.to, currentLayer + 1);
        queue.push(t.to);
      }
    }
  }

  // Assign any unreachable stages to the last layer + 1
  const maxLayer = Math.max(0, ...layers.values());
  for (const stage of stages) {
    if (!layers.has(stage.state)) {
      layers.set(stage.state, maxLayer + 1);
    }
  }

  // Group by layer, then assign Y positions within each layer
  const layerGroups = new Map<number, string[]>();
  for (const [state, layer] of layers) {
    const group = layerGroups.get(layer) ?? [];
    group.push(state);
    layerGroups.set(layer, group);
  }

  for (const [layer, states] of layerGroups) {
    for (let i = 0; i < states.length; i++) {
      positions.set(states[i], {
        x: PADDING + layer * X_SPACING,
        y: PADDING + i * Y_SPACING,
      });
    }
  }

  return positions;
}

export function StateDiagram({ stages, currentState, transitions }: StateDiagramProps) {
  const positions = useMemo(() => layoutStages(stages), [stages]);

  // Compute which state transitions have been traversed
  const traversedEdges = useMemo(() => {
    const edges = new Set<string>();
    if (transitions) {
      for (const t of transitions) {
        edges.add(`${t.fromState}->${t.toState}`);
      }
    }
    return edges;
  }, [transitions]);

  if (stages.length === 0) {
    return (
      <div className="text-sm text-gray-500 italic p-4">
        No stage definitions available.
      </div>
    );
  }

  // Compute SVG dimensions
  const maxX = Math.max(...[...positions.values()].map((p) => p.x)) + NODE_WIDTH + PADDING;
  const maxY = Math.max(...[...positions.values()].map((p) => p.y)) + NODE_HEIGHT + PADDING;

  return (
    <svg
      viewBox={`0 0 ${maxX} ${maxY}`}
      className="w-full"
      style={{ maxHeight: Math.min(maxY, 500), minHeight: 120 }}
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="8"
          markerHeight="6"
          refX="8"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill="#6b7280" />
        </marker>
        <marker
          id="arrowhead-active"
          markerWidth="8"
          markerHeight="6"
          refX="8"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill="#3b82f6" />
        </marker>
      </defs>

      {/* Edges */}
      {stages.flatMap((stage) =>
        stage.validTransitions.map((t) => {
          const from = positions.get(stage.state);
          const to = positions.get(t.to);
          if (!from || !to) return null;

          const edgeKey = `${stage.state}->${t.to}`;
          const isTraversed = traversedEdges.has(edgeKey);
          const strokeColor = isTraversed ? '#3b82f6' : '#4b5563';
          const markerId = isTraversed ? 'arrowhead-active' : 'arrowhead';

          // Simple line from right edge of source to left edge of target
          const x1 = from.x + NODE_WIDTH;
          const y1 = from.y + NODE_HEIGHT / 2;
          const x2 = to.x;
          const y2 = to.y + NODE_HEIGHT / 2;

          // Compute label position at midpoint
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          const label = TRIGGER_LABELS[t.trigger] ?? t.trigger;

          return (
            <g key={edgeKey + t.trigger}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={strokeColor}
                strokeWidth={isTraversed ? 2 : 1}
                markerEnd={`url(#${markerId})`}
                opacity={isTraversed ? 1 : 0.6}
              />
              <text
                x={mx}
                y={my - 6}
                textAnchor="middle"
                fontSize="9"
                fill="#9ca3af"
              >
                {label}
              </text>
            </g>
          );
        }),
      )}

      {/* Nodes */}
      {stages.map((stage) => {
        const pos = positions.get(stage.state);
        if (!pos) return null;

        const isCurrent = stage.state === currentState;
        const colors = ROLE_COLORS[stage.semanticRole] ?? DEFAULT_COLOR;

        return (
          <g key={stage.state}>
            <rect
              x={pos.x}
              y={pos.y}
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
              rx={6}
              fill={colors.bg}
              stroke={isCurrent ? '#f59e0b' : colors.border}
              strokeWidth={isCurrent ? 2.5 : 1}
              opacity={isCurrent ? 1 : 0.85}
            />
            {/* State name */}
            <text
              x={pos.x + NODE_WIDTH / 2}
              y={pos.y + NODE_HEIGHT / 2 - 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="11"
              fontWeight={isCurrent ? 600 : 400}
              fill={colors.text}
            >
              {stage.state}
            </text>
            {/* Semantic role / agent indicator */}
            <text
              x={pos.x + NODE_WIDTH / 2}
              y={pos.y + NODE_HEIGHT / 2 + 11}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="8"
              fill="#9ca3af"
            >
              {stage.humanGate ? '\u{1F464}' : stage.agentActionable ? '\u{1F916}' : ''}
              {stage.agentRoleId ? ` ${stage.agentRoleId}` : ''}
            </text>
            {/* Current state highlight ring */}
            {isCurrent && (
              <rect
                x={pos.x - 3}
                y={pos.y - 3}
                width={NODE_WIDTH + 6}
                height={NODE_HEIGHT + 6}
                rx={9}
                fill="none"
                stroke="#f59e0b"
                strokeWidth={1}
                strokeDasharray="4 2"
                opacity={0.5}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
