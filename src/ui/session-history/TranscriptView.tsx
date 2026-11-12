import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';

// Mirrors src/infrastructure/usage/transcript.ts (UI can't import infrastructure).
type TranscriptBlock =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; hint: string | null; input: string; result: string | null; isError: boolean };

interface TranscriptMessage {
  id: string | null;
  role: 'user' | 'assistant';
  blocks: TranscriptBlock[];
  timestamp: string | null;
}

interface Props {
  sessionId: string;
  /** Re-fetch periodically and stick to the bottom — for watching a running session. */
  live?: boolean;
  /** Bump to reload immediately and jump to the bottom (e.g. after sending a command). */
  refreshKey?: number;
}

const POLL_MS = 1500;
const LIVE_TAIL = 200;

export function TranscriptView({ sessionId, live = false, refreshKey = 0 }: Props) {
  const [messages, setMessages] = useState<TranscriptMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(live);
  const lastBodyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false; // a slow response must not land after (and overwrite) a newer one
    const load = () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      fetch(`/api/session-history/${sessionId}/transcript${live ? `?limit=${LIVE_TAIL}` : ''}`)
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status === 404 ? 'No transcript yet' : `HTTP ${r.status}`))))
        .then((body) => {
          if (cancelled) return;
          setError(null);
          // Skip identical bodies (304s revalidate to the cached one) so polling doesn't re-render the markdown.
          if (body === lastBodyRef.current) return;
          lastBodyRef.current = body;
          setMessages((JSON.parse(body) as { messages: TranscriptMessage[] }).messages);
        })
        .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load transcript'); })
        .finally(() => { inFlight = false; });
    };
    load();
    const timer = live ? setInterval(load, POLL_MS) : undefined;
    const onVisible = () => { if (!document.hidden) load(); };
    if (live) document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [sessionId, live, refreshKey]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // After a send: jump to the bottom now and keep following new output.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!refreshKey || !el) return;
    stickToBottomRef.current = true;
    el.scrollTop = el.scrollHeight;
  }, [refreshKey]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (live && el) stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto px-3 py-3 space-y-3">
      {error && messages === null && <p className="text-xs text-red-400">{error}</p>}
      {!error && messages === null && <p className="text-xs text-gray-500">Loading…</p>}
      {messages?.length === 0 && <p className="text-xs text-gray-600">No messages in this transcript.</p>}
      {messages?.map((m, idx) => (
        <div
          key={m.id ?? idx}
          className={`rounded-lg px-3 py-2 text-sm min-w-0 ${
            m.role === 'user' ? 'bg-gray-800/60 border border-gray-700' : 'bg-blue-950/30 border border-blue-900/40'
          }`}
        >
          <div className="flex items-center gap-2 mb-1 text-[10px] text-gray-500">
            <span className={`font-semibold ${m.role === 'user' ? 'text-gray-300' : 'text-blue-300'}`}>
              {m.role === 'user' ? 'User' : 'Assistant'}
            </span>
            {m.timestamp && <span>{new Date(m.timestamp).toLocaleString()}</span>}
          </div>
          <div className="space-y-1.5">
            {m.blocks.map((b, i) => (b.type === 'text' ? <TextBlock key={i} text={b.text} /> : <ToolBlock key={i} block={b} />))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TextBlock({ text }: { text: string }) {
  return (
    <div className="text-gray-200 break-words markdown-body">
      <Markdown>{text}</Markdown>
    </div>
  );
}

function ToolBlock({ block }: { block: Extract<TranscriptBlock, { type: 'tool' }> }) {
  const status = block.result === null ? 'text-gray-500' : block.isError ? 'text-red-400' : 'text-green-500';
  return (
    <details className="rounded border border-gray-700/70 bg-gray-950/50 text-xs">
      <summary className="cursor-pointer select-none px-2 py-1 flex items-center gap-1.5 min-w-0">
        <span className={status} aria-hidden="true">●</span>
        <span className="font-mono font-semibold text-gray-300 shrink-0">{block.name}</span>
        {block.hint && <span className="font-mono text-gray-500 truncate">{block.hint}</span>}
      </summary>
      <pre className="px-2 py-1 border-t border-gray-800 text-gray-400 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">{block.input}</pre>
      {block.result !== null && (
        <pre className={`px-2 py-1 border-t border-gray-800 whitespace-pre-wrap break-words max-h-64 overflow-y-auto ${block.isError ? 'text-red-300' : 'text-gray-300'}`}>
          {block.result || '(empty result)'}
        </pre>
      )}
    </details>
  );
}
