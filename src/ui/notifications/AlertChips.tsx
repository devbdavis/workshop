import type { SessionAlert } from './SessionAlerts';

interface Props {
  chips: SessionAlert[];
  onOpen: (alert: SessionAlert) => void;
  onDismiss: (id: string) => void;
}

/** Transient bottom-right toasts for needs-input/idle alerts — always shown, even while watching. */
export function AlertChips({ chips, onOpen, onDismiss }: Props) {
  if (chips.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50 max-w-xs">
      {chips.map((alert) => (
        <div
          key={alert.id}
          onClick={() => onOpen(alert)}
          className="flex items-start gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 shadow-lg text-sm cursor-pointer"
        >
          <span
            className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
              alert.kind === 'needs-input' ? 'bg-red-500' : 'bg-yellow-500'
            }`}
          />
          <div className="flex-1 min-w-0">
            <p className="text-gray-200 font-medium truncate">
              {alert.sessionName ?? `Session ${alert.sessionId.slice(0, 8)}`}
            </p>
            <p className="text-gray-400 text-xs">
              {alert.kind === 'needs-input' ? 'Needs input' : 'Idle — waiting for input'}
            </p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss(alert.id); }}
            className="text-gray-600 hover:text-gray-300 transition-colors shrink-0 mt-0.5"
            aria-label="Dismiss"
          >
            <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
