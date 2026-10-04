import { useEffect, useState } from 'react';
import { RefreshButton } from '@ui/shared/RefreshButton';

export interface ChangedFile {
  /** Repo root, relative to the workspace root ('' for the root itself). */
  repo: string;
  /** File path, relative to the workspace root. */
  path: string;
  /** Two-character porcelain status code (e.g. "M ", "??", "R "). */
  status: string;
}

interface Props {
  sessionId: string;
  changes: ChangedFile[] | null;
  onRefresh: () => Promise<void>;
}

/** Short badge label + color for a porcelain XY status code. */
function statusBadge(status: string): { label: string; className: string } {
  const code = status.trim() || status;
  if (code === '??') return { label: '??', className: 'text-gray-400 bg-gray-800' };
  if (code[0] === 'A') return { label: 'A', className: 'text-green-300 bg-green-950/50' };
  if (code[0] === 'D') return { label: 'D', className: 'text-red-300 bg-red-950/50' };
  if (code[0] === 'R') return { label: 'R', className: 'text-blue-300 bg-blue-950/50' };
  return { label: 'M', className: 'text-yellow-300 bg-yellow-950/50' };
}

/** Colors one diff line by its leading marker. */
function diffLineClassName(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-gray-500';
  if (line.startsWith('@@')) return 'text-blue-400';
  if (line.startsWith('+')) return 'text-green-300 bg-green-950/30';
  if (line.startsWith('-')) return 'text-red-300 bg-red-950/30';
  if (line.startsWith('diff --git') || line.startsWith('index ')) return 'text-gray-500';
  return 'text-gray-300';
}

export function DiffView({ sessionId, changes, onRefresh }: Props) {
  const [selected, setSelected] = useState<ChangedFile | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  useEffect(() => {
    if (!selected) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setLoadingDiff(true);
    const qs = new URLSearchParams({ path: selected.path });
    fetch(`/api/sessions/${sessionId}/workspace/diff?${qs}`)
      .then((r) => r.json())
      .then((d: { diff: string }) => { if (!cancelled) setDiff(d.diff); })
      .finally(() => { if (!cancelled) setLoadingDiff(false); });
    return () => { cancelled = true; };
  }, [sessionId, selected]);

  const grouped = new Map<string, ChangedFile[]>();
  for (const change of changes ?? []) {
    const list = grouped.get(change.repo) ?? [];
    list.push(change);
    grouped.set(change.repo, list);
  }

  return (
    <div className="flex flex-col md:flex-row h-full min-h-0">
      <div className="w-full md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-gray-800 overflow-y-auto max-h-48 md:max-h-none">
        <div className="flex items-center justify-between px-2 py-1 border-b border-gray-800">
          <span className="text-xs text-gray-500">{changes?.length ?? 0} changed file{changes?.length === 1 ? '' : 's'}</span>
          <RefreshButton onRefresh={onRefresh} title="Refresh changes" />
        </div>
        {changes === null ? (
          <div className="p-3 text-xs text-gray-500">Loading…</div>
        ) : changes.length === 0 ? (
          <div className="p-3 text-xs text-gray-500">No changes</div>
        ) : (
          Array.from(grouped.entries()).map(([repo, files]) => (
            <div key={repo}>
              <div className="px-2 py-1 text-[10px] text-gray-500 uppercase tracking-wide bg-gray-900/60">
                {repo || '(root)'}
              </div>
              {files.map((file) => {
                const badge = statusBadge(file.status);
                const isSelected = selected?.path === file.path;
                return (
                  <div
                    key={file.path}
                    onClick={() => setSelected(file)}
                    className={`flex items-center gap-2 px-2 py-1 text-xs font-mono cursor-pointer hover:bg-gray-800 truncate ${
                      isSelected ? 'bg-blue-900/40 text-blue-200' : 'text-gray-300'
                    }`}
                    title={file.path}
                  >
                    <span className={`shrink-0 w-5 text-center rounded text-[10px] font-semibold ${badge.className}`}>
                      {badge.label}
                    </span>
                    <span className="truncate">{file.path}</span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto font-mono text-xs">
        {!selected ? (
          <div className="p-3 text-gray-500">Select a file to view its diff</div>
        ) : loadingDiff ? (
          <div className="p-3 text-gray-500">Loading diff…</div>
        ) : !diff ? (
          <div className="p-3 text-gray-500">No diff available</div>
        ) : (
          <pre className="whitespace-pre px-3 py-2">
            {diff.split('\n').map((line, idx) => (
              <div key={idx} className={diffLineClassName(line)}>{line || ' '}</div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}
