import { useEffect, useState } from 'react';
import { RefreshButton } from '@ui/shared/RefreshButton';
import { rightLineNumbers } from '@foundation/diff-utils';
import { useDiffComments, type DiffComment } from './useDiffComments';
import { CommentComposer, CommentItem, OutdatedComments } from './DiffComments';

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
export function diffLineClassName(line: string): string {
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
  const [composingLine, setComposingLine] = useState<number | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const { comments, refetch: refetchComments, create, update, remove, send } = useDiffComments(sessionId);

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
    // `changes` is replaced wholesale on refresh — depend on it so a refresh refetches the diff too.
  }, [sessionId, selected, changes]);

  useEffect(() => { setComposingLine(null); }, [selected]);

  async function handleRefresh(): Promise<void> {
    await onRefresh();
    await refetchComments();
  }

  async function handleSend(): Promise<void> {
    setSending(true);
    setSendError(null);
    try {
      await send();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  const grouped = new Map<string, ChangedFile[]>();
  for (const change of changes ?? []) {
    const list = grouped.get(change.repo) ?? [];
    list.push(change);
    grouped.set(change.repo, list);
  }

  const allComments = comments ?? [];
  const openCount = allComments.filter((c) => c.status === 'open').length;
  const openCountByFile = new Map<string, number>();
  for (const c of allComments) {
    if (c.status !== 'open') continue;
    openCountByFile.set(c.file, (openCountByFile.get(c.file) ?? 0) + 1);
  }

  // A file the agent fully reverted leaves the changes list; keep its comments reachable.
  const changedPaths = new Set((changes ?? []).map((c) => c.path));
  const orphanFiles = [...new Set(allComments.map((c) => c.file))].filter((p) => !changedPaths.has(p));

  const fileComments = selected ? allComments.filter((c) => c.file === selected.path) : [];
  const anchoredByLine = new Map<number, DiffComment[]>();
  for (const c of fileComments) {
    if (!c.anchored) continue;
    const list = anchoredByLine.get(c.line) ?? [];
    list.push(c);
    anchoredByLine.set(c.line, list);
  }
  const outdated = fileComments.filter((c) => !c.anchored);

  const lineNumbers = diff ? rightLineNumbers(diff) : [];

  return (
    <div className="flex flex-col md:flex-row h-full min-h-0">
      <div className="w-full md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-gray-800 overflow-y-auto max-h-48 md:max-h-none">
        <div className="flex items-center justify-between px-2 py-1 border-b border-gray-800 gap-2">
          <span className="text-xs text-gray-500">{changes?.length ?? 0} changed file{changes?.length === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSend}
              disabled={openCount === 0 || sending}
              className="text-[10px] px-2 py-0.5 rounded bg-blue-900/50 text-blue-200 hover:bg-blue-800/60 disabled:opacity-40"
              title="Send all open comments to the agent"
            >
              {sending ? 'Sending…' : `Send ${openCount} to agent`}
            </button>
            <RefreshButton onRefresh={handleRefresh} title="Refresh changes" />
          </div>
        </div>
        {sendError && <div className="px-2 py-1 text-[10px] text-red-300 bg-red-900/20 border-b border-gray-800">{sendError}</div>}
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
                const fileOpenCount = openCountByFile.get(file.path) ?? 0;
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
                    {fileOpenCount > 0 && (
                      <span className="shrink-0 ml-auto text-[10px] px-1 rounded bg-gray-800 text-gray-400">{fileOpenCount}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
        {orphanFiles.length > 0 && (
          <div>
            <div className="px-2 py-1 text-[10px] text-gray-500 uppercase tracking-wide bg-gray-900/60">Commented, no longer changed</div>
            {orphanFiles.map((path) => (
              <div
                key={path}
                onClick={() => setSelected({ repo: '', path, status: '  ' })}
                className={`px-2 py-1 text-xs font-mono cursor-pointer hover:bg-gray-800 truncate ${selected?.path === path ? 'bg-blue-900/40 text-blue-200' : 'text-gray-400'}`}
                title={path}
              >
                {path}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto font-mono text-xs">
        {!selected ? (
          <div className="p-3 text-gray-500">Select a file to view its diff</div>
        ) : (
          <>
            <OutdatedComments
              comments={outdated}
              onUpdate={(id, patch) => update(id, patch)}
              onDelete={(id) => remove(id)}
            />
            {loadingDiff ? (
              <div className="p-3 text-gray-500">Loading diff…</div>
            ) : !diff ? (
              <div className="p-3 text-gray-500">No diff available</div>
            ) : (
              <pre className="whitespace-pre px-3 py-2">
                {diff.split('\n').map((line, idx) => {
                  const number = lineNumbers[idx];
                  const lineComments = number !== null ? anchoredByLine.get(number) : undefined;
                  return (
                    <div key={idx}>
                      <div className={`group flex ${diffLineClassName(line)}`}>
                        <span className="w-10 shrink-0 text-right pr-2 text-gray-600 select-none">{number ?? ''}</span>
                        <span className="w-4 shrink-0">
                          {number !== null && (
                            <button
                              type="button"
                              aria-label="Add comment"
                              title="Add comment"
                              onClick={() => setComposingLine(number)}
                              className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-blue-400 leading-none"
                            >
                              +
                            </button>
                          )}
                        </span>
                        <span className="flex-1">{line || ' '}</span>
                      </div>
                      {lineComments?.map((c) => (
                        <CommentItem
                          key={c.id}
                          comment={c}
                          onUpdate={(patch) => update(c.id, patch)}
                          onDelete={() => remove(c.id)}
                        />
                      ))}
                      {composingLine === number && number !== null && (
                        <CommentComposer
                          onSave={async (body) => { await create(selected.path, number, body); setComposingLine(null); }}
                          onCancel={() => setComposingLine(null)}
                        />
                      )}
                    </div>
                  );
                })}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}
