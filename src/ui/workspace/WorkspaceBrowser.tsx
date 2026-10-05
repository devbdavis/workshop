import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@ui/shared/ConfirmDialog';
import { FileTree, type WorkspaceEntry } from './FileTree';
import { DiffView, type ChangedFile } from './DiffView';
import { useCodeServerAvailable, openInVsCode } from './WorkspaceButtons';

type Tab = 'files' | 'changes';

interface FileState {
  path: string;
  content: string;
  original: string;
  binary: boolean;
  tooLarge: boolean;
}

interface Props {
  sessionId: string;
  onClose: () => void;
}

export function WorkspaceBrowser({ sessionId, onClose }: Props) {
  const [tab, setTab] = useState<Tab | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [rootEntries, setRootEntries] = useState<WorkspaceEntry[] | null>(null);
  const [changes, setChanges] = useState<ChangedFile[] | null>(null);
  const [file, setFile] = useState<FileState | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const codeServerReady = useCodeServerAvailable();

  const dirty = file !== null && file.content !== file.original;

  const refreshChanges = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}/workspace/changes`);
    setChanges((await res.json()) as ChangedFile[]);
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/sessions/${sessionId}/workspace/tree`).then((r) => r.json()) as Promise<{ root: string; entries: WorkspaceEntry[] }>,
      fetch(`/api/sessions/${sessionId}/workspace/changes`).then((r) => r.json()) as Promise<ChangedFile[]>,
    ]).then(([tree, changeList]) => {
      if (cancelled) return;
      setRoot(tree.root);
      setRootEntries(tree.entries);
      setChanges(changeList);
      setTab(changeList.length > 0 ? 'changes' : 'files');
    });
    return () => { cancelled = true; };
  }, [sessionId]);

  const loadFile = useCallback(async (path: string) => {
    setFileLoading(true);
    try {
      const qs = new URLSearchParams({ path });
      const res = await fetch(`/api/sessions/${sessionId}/workspace/file?${qs}`);
      const data = (await res.json()) as { path: string; content: string; binary: boolean; tooLarge: boolean };
      setFile({ path: data.path, content: data.content, original: data.content, binary: data.binary, tooLarge: data.tooLarge });
    } finally {
      setFileLoading(false);
    }
  }, [sessionId]);

  const selectFile = useCallback((path: string) => {
    if (dirty) {
      setPendingPath(path);
      return;
    }
    loadFile(path);
  }, [dirty, loadFile]);

  const save = useCallback(async () => {
    if (!file || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/workspace/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path, content: file.content }),
      });
      if (!res.ok) {
        window.alert(`Save failed: ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.status}`);
        return;
      }
      setFile((f) => (f ? { ...f, original: f.content } : f));
      refreshChanges();
    } finally {
      setSaving(false);
    }
  }, [file, saving, sessionId, refreshChanges]);

  const requestClose = useCallback(() => {
    if (!dirty || window.confirm('Discard unsaved changes?')) onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !pendingPath) { requestClose(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && tab === 'files' && dirty) {
        e.preventDefault();
        save();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose, pendingPath, tab, dirty, save]);

  function handleTextareaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = el.value.slice(0, start) + '  ' + el.value.slice(end);
    setFile((f) => (f ? { ...f, content: next } : f));
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2; });
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-2 md:p-6" onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full h-full max-w-6xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0 gap-3">
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex gap-1">
              <TabButton label="Changes" active={tab === 'changes'} onClick={() => setTab('changes')} />
              <TabButton label="Files" active={tab === 'files'} onClick={() => setTab('files')} />
            </div>
            <span className="text-xs text-gray-500 font-mono truncate" title={root ?? ''}>{root}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {codeServerReady && root && (
              <button
                onClick={() => openInVsCode(sessionId, root)}
                className="text-[10px] text-gray-400 hover:text-blue-400 border border-gray-700 rounded px-2 py-0.5"
              >
                Open in VS Code (web)
              </button>
            )}
            <button onClick={requestClose} className="text-gray-400 hover:text-gray-200 text-xl leading-none px-1">×</button>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          {tab === null ? (
            <div className="p-4 text-xs text-gray-500">Loading…</div>
          ) : tab === 'changes' ? (
            <DiffView sessionId={sessionId} changes={changes} onRefresh={refreshChanges} />
          ) : (
            <div className="flex flex-col md:flex-row h-full min-h-0">
              <div className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-gray-800 overflow-y-auto max-h-48 md:max-h-none">
                {rootEntries && (
                  <FileTree sessionId={sessionId} entries={rootEntries} selectedPath={file?.path ?? null} onSelectFile={selectFile} />
                )}
              </div>
              <div className="flex-1 min-h-0 flex flex-col">
                {!file ? (
                  <div className="p-4 text-xs text-gray-500">Select a file to view or edit it</div>
                ) : fileLoading ? (
                  <div className="p-4 text-xs text-gray-500">Loading…</div>
                ) : file.binary ? (
                  <div className="p-4 text-xs text-gray-500">Binary file — cannot be edited here</div>
                ) : file.tooLarge ? (
                  <div className="p-4 text-xs text-gray-500">File too large to edit here (over 1 MB)</div>
                ) : (
                  <>
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800 shrink-0">
                      <span className="text-xs text-gray-400 font-mono truncate">
                        {file.path}{dirty && <span className="text-yellow-400 ml-1" title="Unsaved changes">●</span>}
                      </span>
                      <button
                        onClick={save}
                        disabled={!dirty || saving}
                        className="text-[10px] px-2 py-0.5 rounded bg-blue-900/50 text-blue-200 hover:bg-blue-800/60 disabled:opacity-40 disabled:hover:bg-blue-900/50"
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                    <textarea
                      value={file.content}
                      onChange={(e) => setFile((f) => (f ? { ...f, content: e.target.value } : f))}
                      onKeyDown={handleTextareaKeyDown}
                      spellCheck={false}
                      wrap="off"
                      className="flex-1 min-h-0 bg-gray-950 text-gray-200 font-mono text-xs p-3 outline-none resize-none whitespace-pre"
                    />
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {pendingPath && (
        <ConfirmDialog
          message="You have unsaved changes to this file. Discard them and switch files?"
          confirmLabel="Discard"
          danger
          onConfirm={() => { const next = pendingPath; setPendingPath(null); loadFile(next); }}
          onCancel={() => setPendingPath(null)}
        />
      )}
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1 rounded ${active ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200'}`}
    >
      {label}
    </button>
  );
}
