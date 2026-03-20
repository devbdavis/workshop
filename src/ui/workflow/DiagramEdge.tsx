/**
 * SVG edge component for state diagram transitions.
 */
import { type DiagramEdge as DiagramEdgeData, type DiagramNode } from './workflow-diagram-config';

interface DiagramEdgeProps {
  edge: DiagramEdgeData;
  fromNode: DiagramNode;
  toNode: DiagramNode;
  showLabel: boolean;
  markerId: string;
}

const NODE_WIDTH = 140;
const NODE_HEIGHT = 36;

function getAnchorPoints(
  fromNode: DiagramNode,
  toNode: DiagramNode,
  isBackward: boolean
): { startX: number; startY: number; endX: number; endY: number } {
  const halfW = NODE_WIDTH / 2;
  const halfH = NODE_HEIGHT / 2;

  // Determine direction
  const dx = toNode.x - fromNode.x;
  const dy = toNode.y - fromNode.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  let startX = fromNode.x;
  let startY = fromNode.y;
  let endX = toNode.x;
  let endY = toNode.y;

  // Vertical alignment — use top/bottom anchors
  if (absY > absX * 0.5) {
    if (dy > 0) {
      startY = fromNode.y + halfH;
      endY = toNode.y - halfH;
    } else {
      startY = fromNode.y - halfH;
      endY = toNode.y + halfH;
    }
    // Slight horizontal offset for backward edges
    if (isBackward) {
      startX = fromNode.x + (dx > 0 ? halfW : -halfW) * 0.6;
      endX = toNode.x + (dx > 0 ? -halfW : halfW) * 0.6;
    }
  }
  // Horizontal alignment — use left/right anchors
  else {
    if (dx > 0) {
      startX = fromNode.x + halfW;
      endX = toNode.x - halfW;
    } else {
      startX = fromNode.x - halfW;
      endX = toNode.x + halfW;
    }
  }

  return { startX, startY, endX, endY };
}

function createPath(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  isBackward: boolean
): string {
  const dx = endX - startX;
  const dy = endY - startY;

  // For straight vertical or nearly straight
  if (Math.abs(dx) < 20) {
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  }

  // For horizontal or angled connections, use quadratic bezier
  const midY = (startY + endY) / 2;

  if (isBackward && dy < 0) {
    // Backward edge going up — route to the side
    const offsetX = dx > 0 ? 40 : -40;
    const ctrlX = startX + offsetX;
    const ctrlY = midY;
    return `M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${endX} ${endY}`;
  }

  // Normal curve
  const ctrlX = (startX + endX) / 2;
  return `M ${startX} ${startY} Q ${ctrlX} ${midY} ${endX} ${endY}`;
}

function getLabelPosition(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  isBackward: boolean
): { x: number; y: number } {
  const t = 0.5;
  const x = startX + (endX - startX) * t;
  const y = startY + (endY - startY) * t;
  // Offset label to the side for readability
  const offset = isBackward ? -15 : 10;
  return { x: x + offset, y };
}

export function DiagramEdge({ edge, fromNode, toNode, showLabel, markerId }: DiagramEdgeProps) {
  const isBackward = edge.backward ?? false;
  const { startX, startY, endX, endY } = getAnchorPoints(fromNode, toNode, isBackward);
  const path = createPath(startX, startY, endX, endY, isBackward);
  const labelPos = getLabelPosition(startX, startY, endX, endY, isBackward);

  const strokeColor = isBackward ? 'rgb(239, 68, 68)' : 'rgb(107, 114, 128)';
  const strokeDash = isBackward ? '4,3' : undefined;

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeDasharray={strokeDash}
        markerEnd={`url(#${markerId})`}
        className="transition-all duration-200"
      />
      {showLabel && (
        <text
          x={labelPos.x}
          y={labelPos.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgb(156, 163, 175)"
          fontSize={9}
          fontFamily="system-ui, sans-serif"
          className="pointer-events-none"
        >
          {edge.trigger}
        </text>
      )}
    </g>
  );
}
