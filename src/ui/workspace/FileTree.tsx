import { useState } from 'react';

export interface WorkspaceEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size?: number;
}

interface TreeProps {
  sessionId: string;
  entries: WorkspaceEntry[];
  selectedPath?: string | null;
  onSelectFile: (path: string) => void;
}

/** Lazy-expanding file tree — fetches a directory's children only when first expanded. */
export function FileTree({ sessionId, entries, selectedPath, onSelectFile }: TreeProps) {
  return (
    <div className="text-xs font-mono py-1">
      {entries.map((entry) => (
        <TreeNode
          key={entry.path}
          sessionId={sessionId}
          entry={entry}
          depth={0}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  );
}

interface NodeProps {
  sessionId: string;
  entry: WorkspaceEntry;
  depth: number;
  selectedPath?: string | null;
  onSelectFile: (path: string) => void;
}

function TreeNode({ sessionId, entry, depth, selectedPath, onSelectFile }: NodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<WorkspaceEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle(): Promise<void> {
    if (entry.type === 'file') {
      onSelectFile(entry.path);
      return;
    }
    if (!expanded && children === null) {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ path: entry.path });
        const res = await fetch(`/api/sessions/${sessionId}/workspace/tree?${qs}`);
        const data = (await res.json()) as { entries: WorkspaceEntry[] };
        setChildren(data.entries);
      } finally {
        setLoading(false);
      }
    }
    setExpanded((v) => !v);
  }

  const isSelected = entry.type === 'file' && entry.path === selectedPath;

  return (
    <div>
      <div
        onClick={toggle}
        style={{ paddingLeft: depth * 14 + 4 }}
        className={`flex items-center gap-1 py-0.5 pr-2 cursor-pointer hover:bg-gray-800 truncate ${
          isSelected ? 'bg-blue-900/40 text-blue-200' : 'text-gray-300'
        }`}
        title={entry.path}
      >
        <span className="text-gray-500 w-3 shrink-0 text-center">
          {entry.type === 'dir' ? (loading ? '…' : expanded ? '▾' : '▸') : ''}
        </span>
        <span className="truncate">{entry.name}</span>
      </div>
      {expanded && children?.map((child) => (
        <TreeNode
          key={child.path}
          sessionId={sessionId}
          entry={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  );
}
