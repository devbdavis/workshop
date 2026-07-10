import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';

interface TicketStatus {
  status: 'pending' | 'done';
  issueKey?: string;
  url?: string;
  title?: string;
  body?: string;
}

const TIMEOUT_MS = 4 * 60_000;

/**
 * Shown while a background agent drafts and files a Linear ticket from a todo.
 * Polls the ticket-status endpoint until the agent reports back, then shows the
 * created ticket's link, title, and body.
 */
export function LinearTicketModal({ todoId, onClose }: { todoId: string; onClose: () => void }) {
  const [result, setResult] = useState<TicketStatus>({ status: 'pending' });
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const start = Date.now();

    async function poll() {
      try {
        const res = await fetch(`/api/todos/${todoId}/linear-ticket-status`);
        const data = (await res.json()) as TicketStatus;
        if (cancelled) return;
        if (data.status === 'done') {
          setResult(data);
          return; // stop polling
        }
      } catch {
        // transient — keep polling
      }
      if (cancelled) return;
      if (Date.now() - start > TIMEOUT_MS) {
        setTimedOut(true);
        return;
      }
      timer = setTimeout(poll, 2_000);
    }

    timer = setTimeout(poll, 1_500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [todoId]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const done = result.status === 'done';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-[min(90vw,42rem)] max-h-[80vh] mx-4 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 shrink-0">
          <h2 className="text-sm font-semibold text-gray-200">
            {done ? 'Linear ticket created' : 'Creating Linear ticket…'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">&times;</button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto">
          {!done && !timedOut && (
            <div className="flex items-center gap-3 text-sm text-gray-400 py-6">
              <span className="w-4 h-4 rounded-full border-2 border-gray-600 border-t-indigo-400 animate-spin" />
              An agent is drafting and filing the ticket. This usually takes under a minute.
            </div>
          )}

          {!done && timedOut && (
            <p className="text-sm text-gray-400 py-6">
              This is taking longer than expected. The agent may still be working — check the{' '}
              <span className="text-gray-300">Linear Tickets</span> track for the session, or close this and
              refresh the todo later.
            </p>
          )}

          {done && (
            <div className="space-y-4">
              {result.url ? (
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 hover:underline font-mono"
                >
                  {result.issueKey ?? 'View ticket'} ↗
                </a>
              ) : result.issueKey ? (
                <span className="text-sm text-gray-300 font-mono">{result.issueKey}</span>
              ) : null}

              {result.title && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Title</label>
                  <p className="text-sm text-gray-200">{result.title}</p>
                </div>
              )}

              {result.body && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Body</label>
                  <div className="text-sm text-gray-300 bg-gray-800 border border-gray-700 rounded-lg p-3 markdown-body">
                    <Markdown>{result.body}</Markdown>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end px-5 py-3 border-t border-gray-800 shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
