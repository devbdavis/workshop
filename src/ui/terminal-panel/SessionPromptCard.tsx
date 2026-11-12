import { useCallback, useEffect, useRef, useState } from 'react';
import type { TuiPrompt } from '@foundation/tui-prompt-types';

export const COMPOSER_INPUT_ID = 'transcript-composer-input';
const POLL_MS = 1500;
const QUICK_KEYS: { label: string; key: string }[] = [
  { label: 'Esc', key: 'Escape' },
  { label: '↑', key: 'Up' },
  { label: '↓', key: 'Down' },
  { label: 'Enter', key: 'Enter' },
];

interface Props {
  sessionId: string;
  /** Called when an option expects free text so the composer can hint and focus. */
  onTypeAnswer: () => void;
}

export function SessionPromptCard({ sessionId, onTypeAnswer }: Props) {
  const [prompt, setPrompt] = useState<TuiPrompt | null>(null);
  const inFlightRef = useRef(false);
  // Bumped on every key press: a poll that started before the press must not resurrect the answered card,
  // or a second tap would answer the *next* dialog (e.g. approve a different tool unseen).
  const pressGenRef = useRef(0);

  const load = useCallback(async () => {
    if (document.hidden || inFlightRef.current) return;
    inFlightRef.current = true;
    const gen = pressGenRef.current;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/prompt`);
      const next = res.ok ? ((await res.json()) as { prompt: TuiPrompt | null }).prompt : null;
      if (gen === pressGenRef.current) setPrompt(next);
    } catch {
      // Transient network error: keep the last card; the next poll corrects it.
    } finally {
      inFlightRef.current = false;
    }
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => { if (!cancelled) void load(); };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [load]);

  const press = async (keys: string[]) => {
    pressGenRef.current++;
    setPrompt(null);
    try {
      await fetch(`/api/sessions/${sessionId}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys }),
      });
    } catch {
      // The re-poll below shows the real screen state either way.
    }
    // Give the TUI a beat to redraw, else the capture can still show the dialog just answered.
    setTimeout(() => void load(), 500);
  };

  const choose = (n: number, label: string) => {
    void press([String(n)]);
    if (label.startsWith('Type something')) {
      onTypeAnswer();
      document.getElementById(COMPOSER_INPUT_ID)?.focus();
    }
  };

  if (!prompt) return null;
  return (
    <div className="shrink-0 max-h-[50%] overflow-y-auto border-t-2 border-amber-500 bg-gray-900 p-2 space-y-2">
      <p className="text-xs font-semibold text-amber-400">Claude needs your input</p>
      {prompt.question && <p className="text-sm text-gray-100 whitespace-pre-wrap break-words">{prompt.question}</p>}
      <div className="space-y-1.5">
        {prompt.options.map((o) => (
          <button
            key={o.n}
            onClick={() => choose(o.n, o.label)}
            className="w-full min-h-11 px-3 py-1.5 text-left rounded border border-amber-700/60 bg-gray-800 text-gray-100"
          >
            <span className="text-sm break-words">
              {o.checked !== undefined && <span aria-hidden="true">{o.checked ? '☑ ' : '☐ '}</span>}
              {o.n}. {o.label}
            </span>
            {o.description && <span className="block text-xs text-gray-400 break-words">{o.description}</span>}
          </button>
        ))}
        {prompt.hasSubmitTab && (
          <button
            onClick={() => void press(['Right'])}
            className="w-full min-h-11 px-3 text-sm rounded bg-amber-600 text-white"
          >
            Next / Submit ›
          </button>
        )}
      </div>
      <div className="flex gap-1.5">
        {QUICK_KEYS.map((k) => (
          <button
            key={k.key}
            onClick={() => void press([k.key])}
            className="flex-1 min-h-11 text-xs rounded border border-gray-700 text-gray-300"
          >
            {k.label}
          </button>
        ))}
      </div>
      <details open={prompt.options.length === 0}>
        <summary className="text-xs text-gray-500 cursor-pointer">Show screen</summary>
        <pre className="mt-1 text-[11px] text-gray-400 overflow-x-auto">{prompt.screen.join('\n')}</pre>
      </details>
    </div>
  );
}
