import type { ActivityState } from './activity';
import type { SessionId } from '@foundation/types';

interface Props {
  sessionId: SessionId;
  activityState: ActivityState;
  className?: string;
}

// Deterministic hash from session ID → index into palette arrays
function hashSessionId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// 5 × 5 × 5 = 125 unique combos
const HAIR_COLORS = ['#2c1810', '#8b4513', '#daa520', '#c0392b', '#1a1a2e'];
const SHIRT_COLORS = ['#3498db', '#e74c3c', '#2ecc71', '#9b59b6', '#f39c12'];
const SKIN_TONES = ['#fde0c8', '#f5c6a5', '#d4a574', '#a0764a', '#6b4226'];

function pickAppearance(sessionId: string) {
  const h = hashSessionId(sessionId);
  return {
    hair: HAIR_COLORS[h % 5]!,
    shirt: SHIRT_COLORS[Math.floor(h / 5) % 5]!,
    skin: SKIN_TONES[Math.floor(h / 25) % 5]!,
  };
}

/**
 * SVG fallback character at a desk — deterministic appearance from session ID.
 * CSS animation classes applied via activityState prop.
 */
export function CharacterSvg({ sessionId, activityState, className }: Props) {
  const { hair, shirt, skin } = pickAppearance(sessionId);
  const cssClass = `office-char-${activityState}`;
  const isWorking = activityState === 'working';
  const isSleeping = activityState === 'sleeping' || activityState === 'floor-sleeping';

  return (
    <svg
      viewBox="0 0 120 100"
      className={`${cssClass} ${className ?? ''}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Character ${activityState}`}
    >
      {/* Desk surface */}
      <rect x="10" y="62" width="100" height="4" rx="1" fill="#5d4037" />
      {/* Desk legs */}
      <rect x="15" y="66" width="4" height="20" fill="#4e342e" />
      <rect x="101" y="66" width="4" height="20" fill="#4e342e" />

      {/* Monitor stand */}
      <rect x="55" y="52" width="10" height="10" fill="#424242" />
      {/* Monitor */}
      <g className="char-monitor" style={{ transformBox: 'fill-box' as const }}>
        <rect x="35" y="30" width="50" height="22" rx="2" fill="#263238" stroke="#37474f" strokeWidth="1" />
        {/* Screen content */}
        {isWorking && (
          <>
            <rect x="39" y="35" width="20" height="2" rx="1" fill="#4caf50" opacity="0.8" />
            <rect x="39" y="39" width="30" height="2" rx="1" fill="#4caf50" opacity="0.6" />
            <rect x="39" y="43" width="15" height="2" rx="1" fill="#4caf50" opacity="0.7" />
          </>
        )}
      </g>

      {/* Character body group */}
      <g className="char-body" style={{ transformBox: 'fill-box' as const }}>
        {/* Torso */}
        <rect x="50" y="42" width="20" height="20" rx="3" fill={shirt} />
        {/* Legs */}
        <rect x="53" y="62" width="6" height="14" rx="2" fill="#37474f" />
        <rect x="61" y="62" width="6" height="14" rx="2" fill="#37474f" />
        {/* Head */}
        <circle cx="60" cy="34" r="10" fill={skin} />
        {/* Hair */}
        <ellipse cx="60" cy="28" rx="10" ry="6" fill={hair} />
        {/* Eyes */}
        <g className="char-eyes" style={{ transformBox: 'fill-box' as const }}>
          <circle cx="56" cy="34" r="1.5" fill="#1a1a1a" />
          <circle cx="64" cy="34" r="1.5" fill="#1a1a1a" />
        </g>
      </g>

      {/* Arms */}
      <g className="char-arms" style={{ transformBox: 'fill-box' as const }}>
        <rect x="42" y="48" width="8" height="4" rx="2" fill={skin} />
        <rect x="70" y="48" width="8" height="4" rx="2" fill={skin} />
      </g>

      {/* Zzz elements — visible only via CSS for sleeping states */}
      {isSleeping && (
        <g>
          <text className="char-zzz" x="78" y="24" fontSize="8" fill="#90caf9" opacity="0">Z</text>
          <text className="char-zzz" x="84" y="18" fontSize="10" fill="#90caf9" opacity="0">Z</text>
          <text className="char-zzz" x="90" y="10" fontSize="12" fill="#90caf9" opacity="0">Z</text>
        </g>
      )}
    </svg>
  );
}
