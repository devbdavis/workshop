/**
 * StateDiagram — renders a workflow's stage definitions as an interactive
 * state diagram using React Flow with dagre auto-layout.
 */
import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  Position,
  BackgroundVariant,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';

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

const NODE_WIDTH = 160;
const NODE_HEIGHT = 52;

const ROLE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  entry:        { bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd' },
  processing:   { bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd' },
  'human-gate': { bg: '#4a3728', border: '#f59e0b', text: '#fcd34d' },
  terminal:     { bg: '#1a3a2a', border: '#22c55e', text: '#86efac' },
  error:        { bg: '#3b1c1c', border: '#ef4444', text: '#fca5a5' },
  waiting:      { bg: '#2e1a4a', border: '#a855f7', text: '#d8b4fe' },
};

const DEFAULT_COLOR = { bg: '#1f2937', border: '#6b7280', text: '#d1d5db' };

const TRIGGER_LABELS: Record<string, string> = {
  'agent-complete':    'agent',
  'human-approve':     'approve',
  'human-reject':      'reject',
  auto:                'auto',
  'all-deps-resolved': 'deps ok',
  'all-tasks-done':    'tasks done',
  manual:              'manual',
  'execution-complete':'exec ok',
  'execution-failed':  'exec fail',
};

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 100, marginx: 20, marginy: 20 });

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return nodes.map((n) => {
    const { x, y } = g.node(n.id);
    return {
      ...n,
      position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });
}

export function StateDiagram({ stages, currentState, transitions }: StateDiagramProps) {
  const traversedEdges = useMemo(() => {
    const s = new Set<string>();
    transitions?.forEach((t) => s.add(`${t.fromState}->${t.toState}`));
    return s;
  }, [transitions]);

  const { nodes, edges } = useMemo(() => {
    const rawNodes: Node[] = stages.map((stage) => {
      const isCurrent = stage.state === currentState;
      const colors = ROLE_COLORS[stage.semanticRole] ?? DEFAULT_COLOR;
      const indicator = stage.humanGate ? '👤' : stage.agentActionable ? '🤖' : '';
      const roleLabel = stage.agentRoleId
        ? stage.agentRoleId.replace(/^spec-to-pr-/, '')
        : '';

      return {
        id: stage.state,
        type: 'default',
        position: { x: 0, y: 0 }, // overwritten by dagre
        style: {
          background: colors.bg,
          border: `${isCurrent ? 2.5 : 1}px solid ${isCurrent ? '#f59e0b' : colors.border}`,
          borderRadius: 8,
          color: colors.text,
          fontSize: 12,
          fontWeight: isCurrent ? 600 : 400,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4px 8px',
          boxShadow: isCurrent ? `0 0 0 3px #f59e0b44` : undefined,
        },
        // Store extra display info in data for the label renderer
        data: {
          label: (
            <div style={{ textAlign: 'center', lineHeight: 1.3 }}>
              <div>{stage.state}</div>
              {(indicator || roleLabel) && (
                <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 2 }}>
                  {indicator}{roleLabel ? ` ${roleLabel}` : ''}
                </div>
              )}
            </div>
          ),
        },
      };
    });

    const rawEdges: Edge[] = stages.flatMap((stage) =>
      stage.validTransitions.map((t) => {
        const key = `${stage.state}->${t.to}`;
        const isTraversed = traversedEdges.has(key);
        const isCancel = t.to === 'cancelled';
        return {
          id: key + t.trigger,
          source: stage.state,
          target: t.to,
          label: TRIGGER_LABELS[t.trigger] ?? t.trigger,
          labelStyle: { fontSize: 9, fill: '#9ca3af' },
          labelBgStyle: { fill: 'transparent' },
          style: {
            stroke: isTraversed ? '#3b82f6' : isCancel ? '#374151' : '#4b5563',
            strokeWidth: isTraversed ? 2 : isCancel ? 0.75 : 1,
            opacity: isCancel ? 0.4 : isTraversed ? 1 : 0.7,
          },
          animated: isTraversed,
          type: 'smoothstep',
        };
      }),
    );

    const layoutedNodes = applyDagreLayout(rawNodes, rawEdges);
    return { nodes: layoutedNodes, edges: rawEdges };
  }, [stages, currentState, traversedEdges]);

  if (stages.length === 0) {
    return (
      <div className="text-sm text-gray-500 italic p-4">
        No stage definitions available.
      </div>
    );
  }

  return (
    <div style={{ height: 480, width: '100%', borderRadius: 8, overflow: 'hidden' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnScroll={true}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1f2937" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
