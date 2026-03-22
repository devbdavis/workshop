/**
 * Interactive SVG state diagram for workflow visualization.
 * Shows epic or task state machine with transitions.
 */
import { useState, useMemo, useId } from 'react';
import {
  getDiagramConfig,
  getPhaseBands,
  type DiagramNode as DiagramNodeData,
} from './workflow-diagram-config';
import { DiagramNode } from './DiagramNode';
import { DiagramEdge } from './DiagramEdge';
import { DiagramTooltip } from './DiagramTooltip';
import { DiagramLegend } from './DiagramLegend';
// TODO: Phase 3 Round 2 — replace with dynamic template fetching from API
// import { getTemplatesForType, type WorkflowTemplate } from '@domain/workflow/templates';

// Temporary stub until dynamic templates are implemented
interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  ticketType: string;
  entryState: string;
  activeStates: string[];
  skippedStates: string[];
  requiredFields: string[];
  builtin: boolean;
}

// Hardcoded templates for backward compat
const BUILTIN_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'epic-standard',
    name: 'Standard',
    description: 'Full workflow',
    ticketType: 'epic',
    entryState: 'idea',
    activeStates: ['idea', 'triaging', 'needs-input', 'specced', 'spec-review', 'planning', 'plan-critique', 'plan-review', 'executing', 'execution-failed', 'splitting', 'in-progress', 'integration-review', 'integration-fix', 'final-review', 'approved', 'merged', 'cancelled'],
    skippedStates: [],
    requiredFields: ['description'],
    builtin: true,
  },
  {
    id: 'task-standard',
    name: 'Standard',
    description: 'Full task flow',
    ticketType: 'task',
    entryState: 'ready',
    activeStates: ['blocked', 'ready', 'in-progress', 'code-review', 'changes-requested', 'done', 'cancelled'],
    skippedStates: [],
    requiredFields: ['description'],
    builtin: true,
  },
];

function getTemplatesForType(ticketType: string): WorkflowTemplate[] {
  return BUILTIN_TEMPLATES.filter(t => t.ticketType === ticketType);
}

interface StateDiagramProps {
  ticketType: 'epic' | 'task';
  /** Optional: highlight active states for a selected template */
  activeStates?: string[];
  /** Optional: states to show as skipped/dimmed */
  skippedStates?: string[];
}

interface TooltipState {
  node: DiagramNodeData;
  position: { x: number; y: number };
}

export function StateDiagram({ ticketType, activeStates, skippedStates }: StateDiagramProps) {
  const uniqueId = useId().replace(/:/g, '');
  const config = getDiagramConfig(ticketType);
  const phaseBands = getPhaseBands(ticketType);
  const templates = useMemo(() => getTemplatesForType(ticketType), [ticketType]);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [showEdgeLabels, setShowEdgeLabels] = useState(true);

  // Determine active/skipped states from template or props
  const effectiveActive = useMemo(() => {
    if (activeStates) return new Set(activeStates);
    if (selectedTemplateId) {
      const template = templates.find(t => t.id === selectedTemplateId);
      if (template) return new Set(template.activeStates);
    }
    return new Set(config.nodes.map(n => n.id));
  }, [activeStates, selectedTemplateId, templates, config.nodes]);

  const effectiveSkipped = useMemo(() => {
    if (skippedStates) return new Set(skippedStates);
    if (selectedTemplateId) {
      const template = templates.find(t => t.id === selectedTemplateId);
      if (template) return new Set(template.skippedStates);
    }
    return new Set<string>();
  }, [skippedStates, selectedTemplateId, templates]);

  // Build node map for edge lookups
  const nodeMap = useMemo(() => {
    const map = new Map<string, DiagramNodeData>();
    for (const node of config.nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [config.nodes]);

  const handleNodeMouseEnter = (node: DiagramNodeData, e: React.MouseEvent) => {
    setHoveredNode(node.id);
    setTooltip({
      node,
      position: { x: e.clientX, y: e.clientY },
    });
  };

  const handleNodeMouseLeave = () => {
    setHoveredNode(null);
    setTooltip(null);
  };

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId === 'all' ? null : templateId);
  };

  // SVG marker definitions
  const markerId = `arrow-${uniqueId}`;
  const markerIdBackward = `arrow-backward-${uniqueId}`;

  return (
    <div className="relative flex flex-col">
      {/* Controls header */}
      <div className="flex items-center gap-4 mb-3 px-1">
        <label className="flex items-center gap-2 text-sm text-gray-400">
          <span>Template:</span>
          <select
            value={selectedTemplateId ?? 'all'}
            onChange={(e) => handleTemplateChange(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
          >
            <option value="all">All States</option>
            {templates.map((t: WorkflowTemplate) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-gray-400">
          <input
            type="checkbox"
            checked={showEdgeLabels}
            onChange={(e) => setShowEdgeLabels(e.target.checked)}
            className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-900"
          />
          <span>Show transition labels</span>
        </label>
      </div>

      {/* Diagram container with scroll */}
      <div className="overflow-auto border border-gray-800 rounded-lg bg-gray-950">
        <svg
          width={config.width}
          height={config.height}
          viewBox={`0 0 ${config.width} ${config.height}`}
          className="block"
        >
          {/* Definitions */}
          <defs>
            {/* Forward arrow marker */}
            <marker
              id={markerId}
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <polygon
                points="0,1 8,4 0,7"
                fill="rgb(107, 114, 128)"
              />
            </marker>
            {/* Backward arrow marker */}
            <marker
              id={markerIdBackward}
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <polygon
                points="0,1 8,4 0,7"
                fill="rgb(239, 68, 68)"
              />
            </marker>
          </defs>

          {/* Phase background bands */}
          {phaseBands.map((band, i) => (
            <g key={band.phase}>
              <rect
                x={0}
                y={band.yStart}
                width={config.width}
                height={band.yEnd - band.yStart}
                fill={i % 2 === 0 ? 'rgba(55, 65, 81, 0.15)' : 'rgba(55, 65, 81, 0.08)'}
              />
              <text
                x={12}
                y={band.yStart + 14}
                fill="rgb(107, 114, 128)"
                fontSize={10}
                fontFamily="system-ui, sans-serif"
                fontWeight={500}
              >
                {band.phase}
              </text>
            </g>
          ))}

          {/* Edges (drawn first, behind nodes) */}
          {config.edges.map((edge, i) => {
            const fromNode = nodeMap.get(edge.from);
            const toNode = nodeMap.get(edge.to);
            if (!fromNode || !toNode) return null;
            return (
              <DiagramEdge
                key={i}
                edge={edge}
                fromNode={fromNode}
                toNode={toNode}
                showLabel={showEdgeLabels}
                markerId={edge.backward ? markerIdBackward : markerId}
              />
            );
          })}

          {/* Nodes */}
          {config.nodes.map((node) => (
            <DiagramNode
              key={node.id}
              node={node}
              isActive={effectiveActive.has(node.id)}
              isSkipped={effectiveSkipped.has(node.id)}
              isHighlighted={hoveredNode === node.id}
              onMouseEnter={handleNodeMouseEnter}
              onMouseLeave={handleNodeMouseLeave}
            />
          ))}

          {/* Note about cancelled state */}
          {config.nodes.some(n => n.id === 'cancelled') && (
            <text
              x={700}
              y={590}
              fill="rgb(107, 114, 128)"
              fontSize={9}
              fontFamily="system-ui, sans-serif"
              textAnchor="middle"
            >
              (reachable from any state)
            </text>
          )}
        </svg>
      </div>

      {/* Legend */}
      <DiagramLegend />

      {/* Tooltip */}
      {tooltip && (
        <DiagramTooltip
          node={tooltip.node}
          edges={config.edges}
          position={tooltip.position}
        />
      )}
    </div>
  );
}
