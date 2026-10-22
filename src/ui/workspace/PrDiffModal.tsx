import { useEffect, useMemo, useState } from 'react';
import type { PullRequest } from '@foundation/types';
import { diffLineClassName } from './DiffView';

interface Props {
  todoId: string;
  pullRequests: PullRequest[];
  onClose: () => void;
}

interface FileDiff { path: string; lines: string[]; added: number; removed: number }

const prLabel = (pr: PullRequest): string =>
  pr.title ?? pr.url.replace(/^.*?([^/]+\/[^/]+)\/pull\/(\d+).*$/, '$1 #$2');

/** Splits a unified diff on `diff --git` boundaries. */
function splitDiff(diff: string): FileDiff[] {
  return diff.split(/^(?=diff --git )/m).filter((c) => c.startsWith('diff --git ')).map((chunk) => {
    const lines = chunk.replace(/\n$/, '').split('\n');
    const path = /^diff --git a\/.* b\/(.*)$/.exec(lines[0])?.[1] ?? lines[0];
    const body = lines.filter((l) => !l.startsWith('+++') && !l.startsWith('---'));
    return {
      path,
      lines,
      added: body.filter((l) => l.startsWith('+')).length,
      removed: body.filter((l) => l.startsWith('-')).length,
    };
  });
}

export function PrDiffModal({ todoId, pullRequests, onClose }: Props) {
  const [prUrl, setPrUrl] = useState(pullRequests[0].url);
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setDiff(null); setError(null); setSelected(0);
    fetch(`/api/todos/${encodeURIComponent(todoId)}/pr-diff?prUrl=${encodeURIComponent(prUrl)}`)
      .then(async (r) => {
        const body = (await r.json()) as { diff?: string; error?: string };
        if (!r.ok) throw new Error(body.error ?? 'Failed to load diff');
        return body.diff ?? '';
      })
      .then((d) => { if (!cancelled) setDiff(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load diff'); });
    return () => { cancelled = true; };
  }, [todoId, prUrl]);

  const files = useMemo(() => (diff ? splitDiff(diff) : []), [diff]);
  const file = files[selected];

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-2 md:p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full h-full max-w-6xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm text-gray-200">PR Diff</span>
            {pullRequests.length > 1 && (
              <select value={prUrl} onChange={(e) => setPrUrl(e.target.value)} className="bg-gray-800 text-xs text-gray-200 border border-gray-700 rounded px-2 py-0.5 max-w-xs">
                {pullRequests.map((pr) => <option key={pr.url} value={pr.url}>{prLabel(pr)}</option>)}
              </select>
            )}
            <a href={prUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline truncate">Open PR</a>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200 text-lg leading-none px-1" aria-label="Close">×</button>
        </div>
        {error ? <p className="p-4 text-sm text-red-400">{error}</p>
          : diff === null ? <p className="p-4 text-sm text-gray-500">Loading diff…</p>
          : !files.length ? <p className="p-4 text-sm text-gray-500">This pull request has no changes.</p>
          : (
            <div className="flex flex-1 min-h-0">
              <ul className="w-64 shrink-0 overflow-y-auto border-r border-gray-800 text-xs">
                {files.map((f, i) => (
                  <li key={f.path}>
                    <button onClick={() => setSelected(i)} className={`w-full text-left px-3 py-1 flex items-center justify-between gap-2 hover:bg-gray-800 ${i === selected ? 'bg-gray-800' : ''}`} title={f.path}>
                      <span className="truncate text-gray-300">{f.path}</span>
                      <span className="shrink-0 font-mono"><span className="text-green-400">+{f.added}</span> <span className="text-red-400">-{f.removed}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
              <pre className="flex-1 overflow-auto text-xs font-mono py-2">
                {file?.lines.map((line, i) => <div key={i} className={`px-3 whitespace-pre ${diffLineClassName(line)}`}>{line || ' '}</div>)}
              </pre>
            </div>
          )}
      </div>
    </div>
  );
}
