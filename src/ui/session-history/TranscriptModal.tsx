import { useEffect, useState } from 'react';

interface TranscriptMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string | null;
}

interface Props {
  sessionId: string;
  title: string;
  onClose: () => void;
}

export function TranscriptModal({ sessionId, title, onClose }: Props) {
  const [messages, setMessages] = useState<TranscriptMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/session-history/${sessionId}/transcript`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { messages: TranscriptMessage[] }) => { if (!cancelled) setMessages(data.messages); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load transcript'); });
    return () => { cancelled = true; };
  }, [sessionId]);

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

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {error && <p className="text-xs text-red-400">{error}</p>}
          {!error && messages === null && <p className="text-xs text-gray-500">Loading…</p>}
          {!error && messages?.length === 0 && <p className="text-xs text-gray-600">No messages in this transcript.</p>}
          {messages?.map((m, idx) => (
            <div
              key={idx}
              className={`rounded-lg px-3 py-2 text-xs ${
                m.role === 'user' ? 'bg-gray-800/60 border border-gray-700' : 'bg-blue-950/30 border border-blue-900/40'
              }`}
            >
              <div className="flex items-center gap-2 mb-1 text-[10px] text-gray-500">
                <span className={`font-semibold ${m.role === 'user' ? 'text-gray-300' : 'text-blue-300'}`}>
                  {m.role === 'user' ? 'User' : 'Assistant'}
                </span>
                {m.timestamp && <span>{new Date(m.timestamp).toLocaleString()}</span>}
              </div>
              <div className="whitespace-pre-wrap break-words text-gray-200">{m.text}</div>
            </div>
          ))}
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
