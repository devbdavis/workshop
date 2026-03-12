import { useRef, useCallback } from 'react';
import type { LayoutNode, LayoutNodeId, SessionId } from '@foundation/types';
import type { Session } from '@foundation/types';
import { TerminalPanel } from './TerminalPanel';
import { SplitDivider } from './SplitDivider';

interface Props {
  node: LayoutNode;
  trackId: string;
  sessions: Session[];
  onSplit: (nodeId: LayoutNodeId, direction: 'horizontal' | 'vertical', newSessionId: SessionId) => void;
  onClose: (nodeId: LayoutNodeId) => void;
  onResize: (splitId: LayoutNodeId, newSizes: number[]) => void;
  onCreateSession: () => Promise<Session | null>;
  onDestroySession: (sessionId: string) => void;
}

export function SplitPaneLayout({
  node,
  trackId,
  sessions,
  onSplit,
  onClose,
  onResize,
  onCreateSession,
  onDestroySession,
}: Props) {
  if (node.type === 'leaf') {
    return (
      <LeafPane
        node={node}
        trackId={trackId}
        sessions={sessions}
        onSplit={onSplit}
        onClose={onClose}
        onCreateSession={onCreateSession}
        onDestroySession={onDestroySession}
      />
    );
  }

  return (
    <SplitContainer
      node={node}
      trackId={trackId}
      sessions={sessions}
      onSplit={onSplit}
      onClose={onClose}
      onResize={onResize}
      onCreateSession={onCreateSession}
      onDestroySession={onDestroySession}
    />
  );
}

// --- Leaf Pane ---

interface LeafProps {
  node: LayoutNode & { type: 'leaf' };
  trackId: string;
  sessions: Session[];
  onSplit: (nodeId: LayoutNodeId, direction: 'horizontal' | 'vertical', newSessionId: SessionId) => void;
  onClose: (nodeId: LayoutNodeId) => void;
  onCreateSession: () => Promise<Session | null>;
  onDestroySession: (sessionId: string) => void;
}

function LeafPane({ node, trackId, sessions, onSplit, onClose, onCreateSession, onDestroySession }: LeafProps) {
  const session = sessions.find((s) => s.id === node.sessionId);

  const handleSplit = useCallback(
    async (direction: 'horizontal' | 'vertical') => {
      const newSession = await onCreateSession();
      if (newSession) {
        onSplit(node.id, direction, newSession.id);
      }
    },
    [node.id, onSplit, onCreateSession],
  );

  return (
    <div className="h-full w-full flex flex-col min-h-0 min-w-0">
      {/* Pane header */}
      <div className="flex items-center justify-between px-2 py-0.5 bg-gray-900 border-b border-gray-800 shrink-0">
        <span className="text-xs text-gray-400 font-mono truncate">
          {session ? `session:${session.id.slice(0, 8)}` : 'empty'}
        </span>
        <div className="flex items-center gap-1">
          {session && (
            <span
              className={`w-2 h-2 rounded-full ${
                session.state === 'active'
                  ? 'bg-green-500'
                  : session.state === 'detached'
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
              }`}
            />
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
          <TerminalPanel trackId={trackId} sessionId={session.id} />
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
  onSplit: (nodeId: LayoutNodeId, direction: 'horizontal' | 'vertical', newSessionId: SessionId) => void;
  onClose: (nodeId: LayoutNodeId) => void;
  onResize: (splitId: LayoutNodeId, newSizes: number[]) => void;
  onCreateSession: () => Promise<Session | null>;
  onDestroySession: (sessionId: string) => void;
}

function SplitContainer({
  node,
  trackId,
  sessions,
  onSplit,
  onClose,
  onResize,
  onCreateSession,
  onDestroySession,
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
              onSplit={onSplit}
              onClose={onClose}
              onResize={onResize}
              onCreateSession={onCreateSession}
              onDestroySession={onDestroySession}
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
