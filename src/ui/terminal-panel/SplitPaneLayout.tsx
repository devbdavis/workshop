import { useRef, useCallback, useState } from 'react';
import type { LayoutNode, LayoutNodeId, SessionId, Todo } from '@foundation/types';
// SessionId is a branded type; using it directly keeps the prop contract tight.
import type { Session } from '@foundation/types';
import { TerminalPanel } from './TerminalPanel';
import { SplitDivider } from './SplitDivider';
import { SessionLinkButtons } from './SessionLinkButtons';

interface Props {
  node: LayoutNode;
  trackId: string;
  sessions: Session[];
  todos: Todo[];
  onSplit: (nodeId: LayoutNodeId, direction: 'horizontal' | 'vertical', newSessionId: SessionId) => void;
  onClose: (nodeId: LayoutNodeId) => void;
  onResize: (splitId: LayoutNodeId, newSizes: number[]) => void;
  onCreateSession: () => Promise<Session | null>;
  onDestroySession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  onMinimize: (sessionId: SessionId) => void;
  autoFocusSessionId?: SessionId | null;
  defaultOpenPath?: string;
  issueBaseUrl?: string;
}

export function SplitPaneLayout({
  node,
  trackId,
  sessions,
  todos,
  onSplit,
  onClose,
  onResize,
  onCreateSession,
  onDestroySession,
  onRenameSession,
  onMinimize,
  autoFocusSessionId,
  defaultOpenPath,
  issueBaseUrl,
}: Props) {
  if (node.type === 'leaf') {
    return (
      <LeafPane
        node={node}
        trackId={trackId}
        sessions={sessions}
        todos={todos}
        onSplit={onSplit}
        onClose={onClose}
        onCreateSession={onCreateSession}
        onDestroySession={onDestroySession}
        onRenameSession={onRenameSession}
        onMinimize={onMinimize}
        autoFocusSessionId={autoFocusSessionId}
        defaultOpenPath={defaultOpenPath}
        issueBaseUrl={issueBaseUrl}
      />
    );
  }

  return (
    <SplitContainer
      node={node}
      trackId={trackId}
      sessions={sessions}
      todos={todos}
      onSplit={onSplit}
      onClose={onClose}
      onResize={onResize}
      onCreateSession={onCreateSession}
      onDestroySession={onDestroySession}
      onRenameSession={onRenameSession}
      onMinimize={onMinimize}
      autoFocusSessionId={autoFocusSessionId}
      defaultOpenPath={defaultOpenPath}
      issueBaseUrl={issueBaseUrl}
    />
  );
}

// --- Leaf Pane ---

interface LeafProps {
  node: LayoutNode & { type: 'leaf' };
  trackId: string;
  sessions: Session[];
  todos: Todo[];
  onSplit: (nodeId: LayoutNodeId, direction: 'horizontal' | 'vertical', newSessionId: SessionId) => void;
  onClose: (nodeId: LayoutNodeId) => void;
  onCreateSession: () => Promise<Session | null>;
  onDestroySession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  onMinimize: (sessionId: SessionId) => void;
  autoFocusSessionId?: SessionId | null;
  defaultOpenPath?: string;
  issueBaseUrl?: string;
}

function LeafPane({ node, trackId, sessions, todos, onSplit, onClose, onCreateSession, onDestroySession, onRenameSession, onMinimize, autoFocusSessionId, defaultOpenPath, issueBaseUrl }: LeafProps) {
  const session = sessions.find((s) => s.id === node.sessionId);
  const linkedTodo = session ? todos.find((t) => t.sessionId === session.id) : undefined;
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSplit = useCallback(
    async (direction: 'horizontal' | 'vertical') => {
      const newSession = await onCreateSession();
      if (newSession) {
        onSplit(node.id, direction, newSession.id);
      }
    },
    [node.id, onSplit, onCreateSession],
  );

  const providerLabel = session?.provider === 'codex' ? 'codex' : 'claude';
  const providerColor = session?.provider === 'codex' ? 'bg-emerald-400' : 'bg-orange-400';
  const displayName = session?.name || (session ? `session:${session.id.slice(0, 8)}` : 'empty');

  const startEditing = useCallback(() => {
    if (!session) return;
    setEditValue(session.name || '');
    setEditing(true);
    // Focus input on next tick after render
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [session]);

  const commitEdit = useCallback(() => {
    if (!session) return;
    const trimmed = editValue.trim();
    onRenameSession(session.id, trimmed);
    setEditing(false);
  }, [session, editValue, onRenameSession]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  return (
    <div className="h-full w-full flex flex-col min-h-0 min-w-0">
      {/* Pane header */}
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
              if (e.key === 'Escape') cancelEdit();
            }}
            className="text-xs text-gray-300 font-mono bg-gray-800 border border-gray-600 rounded px-1 py-0 outline-none focus:border-blue-500 min-w-0 w-40"
            placeholder={session ? `session:${session.id.slice(0, 8)}` : ''}
          />
        ) : (
          <span
            className="text-xs text-gray-400 font-mono truncate cursor-pointer hover:text-gray-200 flex items-center gap-1.5"
            onDoubleClick={startEditing}
            title="Double-click to rename"
          >
            {session && (
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  session.activityStatus === 'needs-input'
                    ? 'bg-red-500'
                    : session.activityStatus === 'idle'
                      ? 'bg-yellow-500'
                      : session.activityStatus === 'working'
                        ? 'bg-green-500'
                        : providerColor
                }`}
                title={`${providerLabel} · ${
                  session.activityStatus === 'needs-input' ? 'Needs input' :
                  session.activityStatus === 'idle' ? 'Idle' :
                  session.activityStatus === 'working' ? 'Working' :
                  session.state
                }`}
              />
            )}
            {displayName}
          </span>
        )}
        <div className="flex items-center gap-1">
          <SessionLinkButtons
            pullRequests={linkedTodo?.pullRequests}
            issueKey={linkedTodo?.issueKey}
            issueBaseUrl={issueBaseUrl}
          />
          {session && (session.worktreeRoot ?? defaultOpenPath) && (() => {
            const editorPath = session.worktreeRoot ?? defaultOpenPath!;
            const terminalPath = session.workingDirectory ?? editorPath;
            return (
              <>
                <button
                  onClick={() => fetch('/api/shell/open-in-editor', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: editorPath }),
                  })}
                  className="flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-blue-400 px-1"
                  title={`Open in Cursor: ${editorPath}`}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  <span>Cursor</span>
                </button>
                <button
                  onClick={() => fetch('/api/shell/open-in-editor', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: terminalPath, app: 'terminal' }),
                  })}
                  className="text-[10px] text-gray-500 hover:text-green-400 px-1 font-mono"
                  title={`Open in iTerm: ${terminalPath}`}
                >
                  &gt;_
                </button>
              </>
            );
          })()}
          {session && (
            <button
              onClick={() => onMinimize(session.id)}
              className="text-xs text-gray-500 hover:text-yellow-400 px-1"
              title="Minimize"
            >
              ─
            </button>
          )}
          <button
            onClick={() => handleSplit('horizontal')}
            className="text-xs text-gray-500 hover:text-blue-400 px-1"
            title="Split right"
          >
            ⊞
          </button>
          <button
            onClick={() => handleSplit('vertical')}
            className="text-xs text-gray-500 hover:text-blue-400 px-1"
            title="Split down"
          >
            ⊟
          </button>
          {session && (
            <button
              onClick={() => {
                onDestroySession(session.id);
                onClose(node.id);
              }}
              className="text-xs text-gray-500 hover:text-red-400 px-1"
              title="Close pane"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {/* Terminal content */}
      <div className="flex-1 min-h-0 min-w-0">
        {session ? (
          <TerminalPanel trackId={trackId} sessionId={session.id} autoFocus={autoFocusSessionId === session.id} />
        ) : (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">
            Session not found
          </div>
        )}
      </div>
    </div>
  );
}

// --- Split Container ---

interface SplitProps {
  node: LayoutNode & { type: 'split' };
  trackId: string;
  sessions: Session[];
  todos: Todo[];
  onSplit: (nodeId: LayoutNodeId, direction: 'horizontal' | 'vertical', newSessionId: SessionId) => void;
  onClose: (nodeId: LayoutNodeId) => void;
  onResize: (splitId: LayoutNodeId, newSizes: number[]) => void;
  onCreateSession: () => Promise<Session | null>;
  onDestroySession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  onMinimize: (sessionId: SessionId) => void;
  autoFocusSessionId?: SessionId | null;
  defaultOpenPath?: string;
  issueBaseUrl?: string;
}

function SplitContainer({
  node,
  trackId,
  sessions,
  todos,
  onSplit,
  onClose,
  onResize,
  onCreateSession,
  onDestroySession,
  onRenameSession,
  onMinimize,
  autoFocusSessionId,
  defaultOpenPath,
  issueBaseUrl,
}: SplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sizesRef = useRef<number[]>(node.sizes);
  sizesRef.current = node.sizes;

  const handleDividerResize = useCallback(
    (index: number, delta: number) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const totalSize = node.direction === 'horizontal' ? rect.width : rect.height;
      if (totalSize === 0) return;

      const deltaPercent = (delta / totalSize) * 100;
      const newSizes = [...sizesRef.current];
      const minSize = 5; // minimum 5%

      newSizes[index] += deltaPercent;
      newSizes[index + 1] -= deltaPercent;

      // Enforce minimums
      if (newSizes[index] < minSize || newSizes[index + 1] < minSize) return;

      sizesRef.current = newSizes;
      // Apply via CSS directly for smooth dragging (skip React re-render)
      const children = containerRef.current.children;
      for (let i = 0; i < children.length; i++) {
        const el = children[i] as HTMLElement;
        if (el.dataset.pane !== undefined) {
          const paneIdx = Number(el.dataset.pane);
          if (paneIdx === index || paneIdx === index + 1) {
            el.style.flexBasis = `${newSizes[paneIdx]}%`;
          }
        }
      }
    },
    [node.direction],
  );

  const handleDividerResizeEnd = useCallback(
    () => {
      // Commit the current sizes to state
      onResize(node.id, [...sizesRef.current]);
    },
    [node.id, onResize],
  );

  const isHorizontal = node.direction === 'horizontal';

  return (
    <div
      ref={containerRef}
      className={`h-full w-full flex ${isHorizontal ? 'flex-row' : 'flex-col'} min-h-0 min-w-0`}
    >
      {node.children.map((child, i) => (
        <ChildWithDivider key={child.id}>
          <div
            data-pane={i}
            className="min-h-0 min-w-0 overflow-hidden"
            style={{ flexBasis: `${node.sizes[i]}%`, flexGrow: 0, flexShrink: 0 }}
          >
            <SplitPaneLayout
              node={child}
              trackId={trackId}
              sessions={sessions}
              todos={todos}
              onSplit={onSplit}
              onClose={onClose}
              onResize={onResize}
              onCreateSession={onCreateSession}
              onDestroySession={onDestroySession}
              onRenameSession={onRenameSession}
              onMinimize={onMinimize}
              autoFocusSessionId={autoFocusSessionId}
              defaultOpenPath={defaultOpenPath}
              issueBaseUrl={issueBaseUrl}
            />
          </div>
          {i < node.children.length - 1 && (
            <SplitDivider
              direction={node.direction}
              onResize={(delta) => handleDividerResize(i, delta)}
              onResizeEnd={handleDividerResizeEnd}
            />
          )}
        </ChildWithDivider>
      ))}
    </div>
  );
}

/** Fragment wrapper to hold a pane + optional divider as siblings */
function ChildWithDivider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
