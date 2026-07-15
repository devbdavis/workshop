interface Props {
  onSend: (seq: string) => void;
}

interface KeyDef {
  label: string;
  seq: string;
}

const KEYS: KeyDef[] = [
  { label: 'Esc', seq: '\x1b' },
  { label: '↑', seq: '\x1b[A' },
  { label: '↓', seq: '\x1b[B' },
  { label: 'Tab', seq: '\t' },
  { label: '⇧Tab', seq: '\x1b[Z' },
  { label: 'Enter', seq: '\r' },
  { label: 'Ctrl-C', seq: '\x03' },
];

/** Row of keys iOS/Android soft keyboards don't expose, for use over the terminal WebSocket. */
export function MobileKeyBar({ onSend }: Props) {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 flex gap-1 overflow-x-auto bg-gray-900/95 p-1">
      {KEYS.map(({ label, seq }) => (
        <button
          key={label}
          type="button"
          className="min-h-9 shrink-0 rounded bg-gray-800 px-3 text-sm text-gray-200 active:bg-gray-700"
          onClick={() => onSend(seq)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
