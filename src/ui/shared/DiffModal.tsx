import { useEffect, useMemo } from 'react';

interface DiffLine {
  type: 'unchanged' | 'added' | 'removed';
  content: string;
  lineA?: number;
  lineB?: number;
}

/** Compute a line-level diff between two texts using LCS. */
function computeDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const m = a.length;
  const n = b.length;

  // LCS DP table
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  let lineA = m;
  let lineB = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: 'unchanged', content: a[i - 1], lineA: lineA--, lineB: lineB-- });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', content: b[j - 1], lineB: lineB-- });
      j--;
    } else {
      result.unshift({ type: 'removed', content: a[i - 1], lineA: lineA-- });
      i--;
    }
  }

  return result;
}

const CONTEXT = 4;

/** Collapse runs of unchanged lines outside the context window. */
function collapseContext(lines: DiffLine[]): Array<DiffLine | { type: 'ellipsis'; count: number }> {
  const changed = new Set<number>();
  lines.forEach((l, idx) => { if (l.type !== 'unchanged') changed.add(idx); });

  const visible = new Set<number>();
  changed.forEach((idx) => {
    for (let d = -CONTEXT; d <= CONTEXT; d++) {
      const n = idx + d;
      if (n >= 0 && n < lines.length) visible.add(n);
    }
  });

  const result: Array<DiffLine | { type: 'ellipsis'; count: number }> = [];
  let skip = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    if (visible.has(idx)) {
      if (skip > 0) {
        result.push({ type: 'ellipsis', count: skip });
        skip = 0;
      }
      result.push(lines[idx]);
    } else {
      skip++;
    }
  }
  if (skip > 0) result.push({ type: 'ellipsis', count: skip });

  return result;
}

interface Props {
  title: string;
  beforeLabel?: string;
  afterLabel?: string;
  before: string;
  after: string;
  onClose: () => void;
}

export function DiffModal({ title, beforeLabel = 'Template', afterLabel = 'Yours', before, after, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const diffLines = useMemo(() => computeDiff(before, after), [before, after]);
  const collapsed = useMemo(() => collapseContext(diffLines), [diffLines]);

  const addedCount = diffLines.filter((l) => l.type === 'added').length;
  const removedCount = diffLines.filter((l) => l.type === 'removed').length;
  const isIdentical = addedCount === 0 && removedCount === 0;

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-[1100px] max-w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {isIdentical ? (
              <p className="text-xs text-green-400 mt-0.5">No differences — content is identical</p>
            ) : (
              <p className="text-xs text-gray-400 mt-0.5">
                <span className="text-green-400">+{addedCount} added</span>
                <span className="mx-2 text-gray-600">·</span>
                <span className="text-red-400">-{removedCount} removed</span>
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-2xl leading-none px-1">×</button>
        </div>

        {/* Column headers */}
        <div className="grid grid-cols-2 border-b border-gray-800 shrink-0">
          <div className="px-6 py-2 text-xs font-medium text-gray-400 border-r border-gray-800">
            {beforeLabel} <span className="text-red-400 ml-1">(template)</span>
          </div>
          <div className="px-6 py-2 text-xs font-medium text-gray-400">
            {afterLabel} <span className="text-green-400 ml-1">(yours)</span>
          </div>
        </div>

        {/* Diff body */}
        <div className="flex-1 overflow-y-auto font-mono text-xs">
          {collapsed.map((entry, idx) => {
            if ('count' in entry) {
              return (
                <div key={idx} className="bg-gray-800/40 text-gray-500 px-6 py-1 text-center">
                  ··· {entry.count} unchanged line{entry.count !== 1 ? 's' : ''} ···
                </div>
              );
            }

            const line = entry as DiffLine;

            if (line.type === 'unchanged') {
              return (
                <div key={idx} className="grid grid-cols-2 border-b border-gray-800/30">
                  <div className="px-4 py-0.5 text-gray-400 border-r border-gray-800/30 whitespace-pre-wrap break-all">{line.content}</div>
                  <div className="px-4 py-0.5 text-gray-400 whitespace-pre-wrap break-all">{line.content}</div>
                </div>
              );
            }

            if (line.type === 'removed') {
              return (
                <div key={idx} className="grid grid-cols-2 border-b border-gray-800/30 bg-red-950/30">
                  <div className="px-4 py-0.5 text-red-300 border-r border-gray-800/30 whitespace-pre-wrap break-all">
                    <span className="text-red-500 mr-1 select-none">-</span>{line.content}
                  </div>
                  <div className="px-4 py-0.5" />
                </div>
              );
            }

            // added
            return (
              <div key={idx} className="grid grid-cols-2 border-b border-gray-800/30 bg-green-950/30">
                <div className="px-4 py-0.5 border-r border-gray-800/30" />
                <div className="px-4 py-0.5 text-green-300 whitespace-pre-wrap break-all">
                  <span className="text-green-500 mr-1 select-none">+</span>{line.content}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-gray-800 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
