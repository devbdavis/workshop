import { useState, useRef, useCallback } from 'react';
import type { Session, Todo } from '@foundation/types';
import { TerminalPanel } from './TerminalPanel';
import { ActivityDot } from '@ui/shared/ActivityDot';
import { SessionLinkButtons } from './SessionLinkButtons';
import { useLaunchApps, editorLabel, terminalLabel } from '@ui/hooks/useLaunchApps';
import { useEditorLaunch } from '@ui/hooks/useEditorLaunch';
import { WorkspaceButtons } from '@ui/workspace/WorkspaceButtons';

interface PaneProps {
  trackId: string;
  session: Session;
  todos: Todo[];
  onDestroy: () => void;
  onRename: (name: string) => void;
  defaultOpenPath?: string;
  autoFocus: boolean;
  focusTrigger?: number;
  issueBaseUrl?: string;
  onOpenTerminal?: (cwd: string) => void;
}

export function TerminalPane({ trackId, session, todos, onDestroy, onRename, defaultOpenPath, autoFocus, focusTrigger, issueBaseUrl, onOpenTerminal }: PaneProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const launchApps = useLaunchApps();
  const editor = useEditorLaunch();
  const editorName = editor.uriPrefix ? 'Editor' : editorLabel(launchApps);

  const displayName = session.name || `session:${session.id.slice(0, 8)}`;
  const editorPath = session.worktreeRoot ?? defaultOpenPath;
  const terminalPath = session.workingDirectory ?? editorPath;
  const linkedTodo = todos.find((t) => t.sessionId === session.id);

  const startEditing = useCallback(() => {
    setEditValue(session.name || '');
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [session.name]);

  const commitEdit = useCallback(() => {
    onRename(editValue.trim());
    setEditing(false);
  }, [editValue, onRename]);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between px-2 py-0.5 bg-gray-900 border-b border-gray-800 shrink-0">
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="text-xs text-gray-300 font-mono bg-gray-800 border border-gray-600 rounded px-1 py-0 outline-none focus:border-blue-500 w-40"
          />
        ) : (
          <span
            className="text-xs text-gray-400 font-mono truncate cursor-pointer hover:text-gray-200 flex items-center gap-1.5"
            onDoubleClick={startEditing}
            title="Double-click to rename"
          >
            <ActivityDot activityStatus={session.activityStatus} className="shrink-0" />
            {displayName}
          </span>
        )}
        <div className="flex items-center gap-1">
          <SessionLinkButtons
            pullRequests={linkedTodo?.pullRequests}
            issueKey={linkedTodo?.issueKey}
            issueBaseUrl={issueBaseUrl}
          />
          {editorPath && (
            <>
              <button
                onClick={() => editor.openInEditor(editorPath, session.id)}
                className="flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-blue-400 px-1"
                title={`Open in ${editorName} on your computer: ${editorPath}`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                <span>{editorName}</span>
              </button>
            </>
          )}
          <WorkspaceButtons sessionId={session.id} editorPath={editorPath} />
          {/* Native install (a host terminal is detected and no remote editor
              URI prefix is configured) → open the local terminal emulator, as it
              worked before the in-app shell landed. Otherwise (Docker / remote
              host) fall back to the in-app dockable shell, which runs inside the
              container. Gated on terminalPath, not editorPath: a session can have
              a working directory without the track exposing an editor root. */}
          {terminalPath && launchApps?.resolvedTerminal && !editor.uriPrefix ? (
            <button
              onClick={() => fetch('/api/shell/open-in-editor', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: terminalPath, app: 'terminal', sessionId: session.id }),
              })}
              className="text-[10px] text-gray-500 hover:text-green-400 px-1 font-mono"
              title={`Open ${terminalLabel(launchApps)} on your computer: ${terminalPath}`}
            >
              &gt;_
            </button>
          ) : onOpenTerminal && terminalPath ? (
            <button
              onClick={() => onOpenTerminal(terminalPath)}
              className="text-[10px] text-gray-500 hover:text-green-400 px-1 font-mono"
              title={`Open a shell in the browser: ${terminalPath}`}
            >
              &gt;_
            </button>
          ) : null}
          <button
            onClick={onDestroy}
            className="text-xs text-gray-500 hover:text-red-400 px-1"
            title="Destroy session"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <TerminalPanel trackId={trackId} sessionId={session.id} autoFocus={autoFocus} focusTrigger={focusTrigger} />
      </div>
    </div>
  );
}
