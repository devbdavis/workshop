/**
 * Legend component for state diagram color coding.
 */
import { NODE_STYLES, type NodeType } from './workflow-diagram-config';

interface LegendItem {
  type: NodeType;
  label: string;
}

const LEGEND_ITEMS: LegendItem[] = [
  { type: 'agent', label: 'Agent-actionable' },
  { type: 'human-gate', label: 'Human Gate' },
  { type: 'terminal', label: 'Terminal' },
  { type: 'auto', label: 'Auto-transition' },
  { type: 'waiting', label: 'Waiting' },
];

export function DiagramLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 mt-4 px-4 py-2 bg-gray-900/50 rounded-lg border border-gray-800">
      {LEGEND_ITEMS.map(({ type, label }) => {
        const style = NODE_STYLES[type];
        return (
          <div key={type} className="flex items-center gap-2">
            <svg width="20" height="14" viewBox="0 0 20 14">
              <rect
                x="1"
                y="1"
                width="18"
                height="12"
                rx="3"
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth="1.5"
              />
            </svg>
            <span className="text-xs text-gray-400">{label}</span>
          </div>
        );
      })}

      {/* Rejection path indicator */}
      <div className="flex items-center gap-2">
        <svg width="24" height="14" viewBox="0 0 24 14">
          <line
            x1="2"
            y1="7"
            x2="22"
            y2="7"
            stroke="rgb(239, 68, 68)"
            strokeWidth="1.5"
            strokeDasharray="4,3"
          />
          <polygon
            points="22,7 17,4 17,10"
            fill="rgb(239, 68, 68)"
          />
        </svg>
        <span className="text-xs text-gray-400">Rejection path</span>
      </div>
    </div>
  );
}
