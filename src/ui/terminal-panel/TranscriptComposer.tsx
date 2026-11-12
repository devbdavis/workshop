import { useRef, useState } from 'react';

interface Props {
  sessionId: string;
  onSent: () => void;
}

export function TranscriptComposer({ sessionId, onSent }: Props) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  const post = async (body: { text: string } | { key: 'Escape' }): Promise<boolean> => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(res.status === 409 ? 'Session not running' : `Send failed (HTTP ${res.status})`);
        return false;
      }
      onSent();
      return true;
    } catch {
      setError('Send failed (network)');
      return false;
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    if (!text.trim() || sending) return;
    const sent = text;
    // Clear first so anything typed during the ~400ms send isn't wiped; restore on failure.
    setText('');
    if (areaRef.current) areaRef.current.style.height = 'auto';
    if (!(await post({ text: sent }))) setText((cur) => cur || sent);
  };

  return (
    <div className="shrink-0 border-t border-gray-800 bg-gray-900 p-2">
      {error && <p className="text-xs text-red-400 mb-1">{error}</p>}
      <div className="flex items-end gap-2">
        <button
          onClick={() => void post({ key: 'Escape' })}
          disabled={sending}
          title="Interrupt"
          className="min-h-11 min-w-11 px-2 text-xs rounded border border-gray-700 text-gray-300 disabled:opacity-50"
        >
          Esc
        </button>
        <textarea
          ref={areaRef}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onInput={(e) => {
            // Auto-grow up to ~5 lines (24px line height).
            e.currentTarget.style.height = 'auto';
            e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 120)}px`;
          }}
          onKeyDown={(e) => {
            // Hardware keyboards: Enter sends. Touch: Enter is a newline, the Send button sends. 229 = Safari IME commit.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229 && !coarse) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Message Claude…"
          className="flex-1 min-h-11 resize-none rounded bg-gray-800 border border-gray-700 px-2 py-2 text-base leading-6 text-gray-100 outline-none focus:border-blue-500"
        />
        <button
          onClick={() => void send()}
          disabled={sending || !text.trim()}
          className="min-h-11 min-w-11 px-3 text-sm rounded bg-blue-600 text-white disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
