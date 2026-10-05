import { useEffect } from 'react';
import { TranscriptView } from './TranscriptView';

interface Props {
  sessionId: string;
  title: string;
  onClose: () => void;
}

export function TranscriptModal({ sessionId, title, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-[800px] max-w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <h2 className="text-sm font-semibold truncate">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-2xl leading-none px-1 shrink-0">×</button>
        </div>

        <div className="flex-1 min-h-0">
          <TranscriptView sessionId={sessionId} />
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-800 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
