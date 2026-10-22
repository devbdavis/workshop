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
export function splitDiff(diff: string): FileDiff[] {
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

interface DirNode { dirs: Map<string, DirNode>; files: FileDiff[] }

export function buildTree(files: FileDiff[]): DirNode {
  const root: DirNode = { dirs: new Map(), files: [] };
  for (const f of files) {
    let node = root;
    for (const part of f.path.split('/').slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
      node = node.dirs.get(part)!;
    }
    node.files.push(f);
  }
  return root;
}

interface TreeProps {
  node: DirNode;
  prefix: string;
  depth: number;
  collapsed: Set<string>;
  onToggle: (dir: string) => void;
  selected?: string;
  onSelect: (path: string) => void;
}

/** Static mirror of FileTree's look; every directory starts expanded. */
function DiffTree({ node, prefix, depth, collapsed, onToggle, selected, onSelect }: TreeProps) {
  const pad = { paddingLeft: depth * 14 + 4 };
  return (
    <>
      {[...node.dirs].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => {
        const dir = prefix + name;
        const open = !collapsed.has(dir);
        return (
          <div key={dir}>
            <div onClick={() => onToggle(dir)} style={pad} className="flex items-center gap-1 py-0.5 pr-2 cursor-pointer hover:bg-gray-800 truncate text-gray-300" title={dir}>
              <span className="text-gray-500 w-3 shrink-0 text-center">{open ? '▾' : '▸'}</span>
              <span className="truncate">{name}</span>
            </div>
            {open && <DiffTree node={child} prefix={`${dir}/`} depth={depth + 1} collapsed={collapsed} onToggle={onToggle} selected={selected} onSelect={onSelect} />}
          </div>
        );
      })}
      {[...node.files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => (
        <div key={f.path} onClick={() => onSelect(f.path)} style={pad} className={`flex items-center gap-1 py-0.5 pr-2 cursor-pointer hover:bg-gray-800 ${f.path === selected ? 'bg-blue-900/40 text-blue-200' : 'text-gray-300'}`} title={f.path}>
          <span className="w-3 shrink-0" />
          <span className="truncate">{f.path.slice(prefix.length)}</span>
          <span className="shrink-0 ml-auto"><span className="text-green-400">+{f.added}</span> <span className="text-red-400">-{f.removed}</span></span>
        </div>
      ))}
    </>
  );
}

export function PrDiffModal({ todoId, pullRequests, onClose }: Props) {
  const [prUrl, setPrUrl] = useState(pullRequests[0].url);
  const [diff, setDiff] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleDir = (dir: string): void => setCollapsed((s) => {
    const next = new Set(s);
    if (!next.delete(dir)) next.add(dir);
    return next;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setDiff(null); setError(null); setSelected(null); setCollapsed(new Set());
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
  const tree = useMemo(() => buildTree(files), [files]);
  const file = files.find((f) => f.path === selected) ?? files[0];

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
              <div className="w-72 shrink-0 overflow-y-auto border-r border-gray-800 text-xs font-mono py-1">
                <DiffTree node={tree} prefix="" depth={0} collapsed={collapsed} onToggle={toggleDir} selected={file?.path} onSelect={setSelected} />
              </div>
              <pre className="flex-1 overflow-auto text-xs font-mono py-2">
                {file?.lines.map((line, i) => <div key={i} className={`px-3 whitespace-pre ${diffLineClassName(line)}`}>{line || ' '}</div>)}
              </pre>
            </div>
          )}
      </div>
    </div>
  );
}
