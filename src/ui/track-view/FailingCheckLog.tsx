import { useState } from 'react';

interface Props {
  todoId: string;
  prUrl: string;
  checkName: string;
}

/** Collapsed tail of a failing check's job log, fetched on first expand. */
export function FailingCheckLog({ todoId, prUrl, checkName }: Props) {
  const [log, setLog] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (log !== null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ prUrl, check: checkName });
      const res = await fetch(`/api/todos/${todoId}/pr-monitors/check-log?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      setLog(typeof data.log === 'string' && data.log ? data.log : '(empty log)');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch log');
    } finally {
      setLoading(false);
    }
  }

  return (
    <details onToggle={(e) => e.currentTarget.open && load()} className="mt-1">
      <summary className="cursor-pointer text-[11px] text-gray-400 hover:text-gray-200 select-none">Log tail</summary>
      {loading && <p className="text-[11px] text-gray-500 italic mt-1">Fetching log…</p>}
      {error && (
        <p className="text-[11px] text-red-400 mt-1">
          {error}{' '}
          <button className="underline hover:text-red-300" onClick={load}>Retry</button>
        </p>
      )}
      {log !== null && (
        <pre className="mt-1 max-h-64 overflow-auto rounded bg-gray-950 border border-gray-800 p-2 text-[10px] leading-snug text-gray-300 whitespace-pre">
          {log}
        </pre>
      )}
    </details>
  );
}
