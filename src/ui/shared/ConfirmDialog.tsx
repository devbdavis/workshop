import { useEffect } from 'react';

interface Props {
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** In-app replacement for window.confirm — matches the modal styling used across the app. */
export function ConfirmDialog({ message, confirmLabel = 'Confirm', danger, onConfirm, onCancel }: Props) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-[420px] max-w-full p-5 space-y-4">
        <p className="text-sm text-gray-200">{message}</p>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1 text-xs font-medium rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={`px-3 py-1 text-xs font-medium rounded ${
              danger ? 'bg-red-900/50 text-red-300 hover:bg-red-900/70' : 'bg-blue-900/60 text-blue-200 hover:bg-blue-800/60'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
