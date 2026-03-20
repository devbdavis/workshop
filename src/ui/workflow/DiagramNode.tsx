/**
 * SVG node component for state diagram visualization.
 */
import { type DiagramNode as DiagramNodeData, NODE_STYLES, type NodeStyle } from './workflow-diagram-config';

interface DiagramNodeProps {
  node: DiagramNodeData;
  isActive: boolean;
  isSkipped: boolean;
  isHighlighted: boolean;
  onMouseEnter: (node: DiagramNodeData, e: React.MouseEvent) => void;
  onMouseLeave: () => void;
}

const NODE_WIDTH = 140;
const NODE_HEIGHT = 36;
const CORNER_RADIUS = 6;

function getOpacity(isActive: boolean, isSkipped: boolean, isHighlighted: boolean): number {
  if (isSkipped) return 0.25;
  if (isHighlighted) return 1;
  if (!isActive) return 0.4;
  return 1;
}

function formatLabel(label: string): string {
  return label
    .replace(/-/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function DiagramNode({
  node,
  isActive,
  isSkipped,
  isHighlighted,
  onMouseEnter,
  onMouseLeave,
}: DiagramNodeProps) {
  const style: NodeStyle = NODE_STYLES[node.type];
  const opacity = getOpacity(isActive, isSkipped, isHighlighted);
  const x = node.x - NODE_WIDTH / 2;
  const y = node.y - NODE_HEIGHT / 2;

  const hasAgentInfo = node.agentRole && node.agentCount;

  return (
    <g
      style={{ opacity, transition: 'opacity 200ms ease' }}
      onMouseEnter={(e) => onMouseEnter(node, e)}
      onMouseLeave={onMouseLeave}
      className="cursor-pointer"
    >
      {/* Node rectangle */}
      <rect
        x={x}
        y={y}
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={CORNER_RADIUS}
        ry={CORNER_RADIUS}
        fill={style.fill}
        stroke={style.stroke}
        strokeWidth={2}
        className="transition-all duration-200"
      />

      {/* Node label */}
      <text
        x={node.x}
        y={node.y + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={style.textColor}
        fontSize={11}
        fontWeight={500}
        fontFamily="system-ui, sans-serif"
      >
        {formatLabel(node.label)}
      </text>

      {/* Agent badge below node */}
      {hasAgentInfo && (
        <text
          x={node.x}
          y={y + NODE_HEIGHT + 12}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgb(96, 165, 250)"
          fontSize={9}
          fontFamily="system-ui, sans-serif"
        >
          {node.agentRole} x{node.agentCount}
        </text>
      )}

      {/* Type indicator icon */}
      {node.type === 'human-gate' && (
        <circle
          cx={x + NODE_WIDTH - 10}
          cy={y + 10}
          r={4}
          fill="rgb(245, 158, 11)"
        />
      )}
    </g>
  );
}
