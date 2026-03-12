import { useState, useCallback, useRef, useEffect } from 'react';
import { v4 as uuid } from 'uuid';
import type { TerminalLayout, LayoutNode, LayoutLeaf, LayoutSplit, LayoutNodeId, SessionId } from '@foundation/types';
import type { Session } from '@foundation/types';

/** Build a default layout from a list of foreground sessions (vertical stack) */
function buildDefaultLayout(sessions: Session[]): TerminalLayout {
  const fg = sessions.filter((s) => !s.background);
  if (fg.length === 0) return { root: null };
  if (fg.length === 1) {
    return {
      root: {
        type: 'leaf',
        id: uuid() as LayoutNodeId,
        sessionId: fg[0].id,
      },
    };
  }
  return {
    root: {
      type: 'split',
      id: uuid() as LayoutNodeId,
      direction: 'vertical',
      children: fg.map((s) => ({
        type: 'leaf' as const,
        id: uuid() as LayoutNodeId,
        sessionId: s.id,
      })),
      sizes: fg.map(() => 100 / fg.length),
    },
  };
}

/** Collect all session IDs referenced in a layout tree */
function collectSessionIds(node: LayoutNode | null): Set<SessionId> {
  if (!node) return new Set();
  if (node.type === 'leaf') return new Set([node.sessionId]);
  const ids = new Set<SessionId>();
  for (const child of node.children) {
    for (const id of collectSessionIds(child)) ids.add(id);
  }
  return ids;
}

/** Remove a node by ID from the tree, returning the pruned tree (or null if root was removed) */
function removeNode(node: LayoutNode, targetId: LayoutNodeId): LayoutNode | null {
  if (node.id === targetId) return null;
  if (node.type === 'leaf') return node;
  const remaining: LayoutNode[] = [];
  const remainingSizes: number[] = [];
  for (let i = 0; i < node.children.length; i++) {
    const result = removeNode(node.children[i], targetId);
    if (result) {
      remaining.push(result);
      remainingSizes.push(node.sizes[i]);
    }
  }
  if (remaining.length === 0) return null;
  if (remaining.length === 1) return remaining[0];
  // Normalize sizes
  const total = remainingSizes.reduce((a, b) => a + b, 0);
  const normalizedSizes = remainingSizes.map((s) => (s / total) * 100);
  return { ...node, children: remaining, sizes: normalizedSizes };
}

/** Remove a session from the tree by session ID */
function removeSessionFromTree(node: LayoutNode, sessionId: SessionId): LayoutNode | null {
  if (node.type === 'leaf') {
    return node.sessionId === sessionId ? null : node;
  }
  const remaining: LayoutNode[] = [];
  const remainingSizes: number[] = [];
  for (let i = 0; i < node.children.length; i++) {
    const result = removeSessionFromTree(node.children[i], sessionId);
    if (result) {
      remaining.push(result);
      remainingSizes.push(node.sizes[i]);
    }
  }
  if (remaining.length === 0) return null;
  if (remaining.length === 1) return remaining[0];
  const total = remainingSizes.reduce((a, b) => a + b, 0);
  const normalizedSizes = remainingSizes.map((s) => (s / total) * 100);
  return { ...node, children: remaining, sizes: normalizedSizes };
}

/** Split a leaf node in a given direction, adding a new session */
function splitNode(
  node: LayoutNode,
  targetId: LayoutNodeId,
  direction: 'horizontal' | 'vertical',
  newSessionId: SessionId,
): LayoutNode {
  if (node.id === targetId) {
    return {
      type: 'split',
      id: uuid() as LayoutNodeId,
      direction,
      children: [
        node,
        { type: 'leaf', id: uuid() as LayoutNodeId, sessionId: newSessionId },
      ],
      sizes: [50, 50],
    };
  }
  if (node.type === 'split') {
    return {
      ...node,
      children: node.children.map((child) => splitNode(child, targetId, direction, newSessionId)),
    };
  }
  return node;
}

/** Update sizes for a split node by ID */
function updateSizes(node: LayoutNode, splitId: LayoutNodeId, newSizes: number[]): LayoutNode {
  if (node.type === 'leaf') return node;
  if (node.id === splitId) {
    return { ...node, sizes: newSizes };
  }
  return {
    ...node,
    children: node.children.map((child) => updateSizes(child, splitId, newSizes)),
  };
}

export interface UseTerminalLayoutResult {
  layout: TerminalLayout;
  splitPane: (nodeId: LayoutNodeId, direction: 'horizontal' | 'vertical', newSessionId: SessionId) => void;
  closePane: (nodeId: LayoutNodeId) => void;
  resizePanes: (splitId: LayoutNodeId, newSizes: number[]) => void;
  /** Sync layout with current session list (add missing, remove stale) */
  syncWithSessions: (sessions: Session[]) => void;
}

export function useTerminalLayout(
  trackId: string,
  sessions: Session[],
): UseTerminalLayoutResult {
  const [layout, setLayoutState] = useState<TerminalLayout>({ root: null });
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trackIdRef = useRef(trackId);
  trackIdRef.current = trackId;

  // Keep a ref to the latest layout so the sync effect always reads current state
  const layoutRef = useRef<TerminalLayout>(layout);
  layoutRef.current = layout;

  // Track pending save data for flush-on-unmount
  const pendingSaveRef = useRef<TerminalLayout | null>(null);

  // Immediate save (no debounce) — used for flush-on-unmount
  const saveLayoutImmediate = useCallback(
    (newLayout: TerminalLayout) => {
      fetch(`/api/tracks/${trackIdRef.current}/layout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLayout),
      }).catch((err) => console.error('Failed to save layout:', err));
    },
    [],
  );

  // Debounced save to server
  const saveLayout = useCallback(
    (newLayout: TerminalLayout) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      pendingSaveRef.current = newLayout;
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        pendingSaveRef.current = null;
        saveLayoutImmediate(newLayout);
      }, 500);
    },
    [saveLayoutImmediate],
  );

  const setLayout = useCallback(
    (newLayout: TerminalLayout) => {
      setLayoutState(newLayout);
      saveLayout(newLayout);
    },
    [saveLayout],
  );

  // Flush any pending debounced save on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (pendingSaveRef.current) {
        saveLayoutImmediate(pendingSaveRef.current);
        pendingSaveRef.current = null;
      }
    };
  }, [saveLayoutImmediate]);

  // Load layout from server on mount (or when trackId changes)
  useEffect(() => {
    let cancelled = false;
    // Reset loaded state so sync effect doesn't run with stale layout
    setLoaded(false);
    fetch(`/api/tracks/${trackId}/layout`)
      .then((res) => res.json())
      .then((data: TerminalLayout) => {
        if (!cancelled) {
          setLayoutState(data);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [trackId]);

  // Sync layout with sessions whenever sessions or loaded state changes
  useEffect(() => {
    if (!loaded) return;

    // Read from ref to always get the latest layout value,
    // avoiding stale closures when sessions trigger this effect
    const currentLayout = layoutRef.current;
    const foreground = sessions.filter((s) => !s.background);

    if (foreground.length === 0) {
      if (currentLayout.root !== null) {
        setLayout({ root: null });
      }
      return;
    }

    const layoutSessionIds = collectSessionIds(currentLayout.root);
    const activeSessionIds = new Set(foreground.map((s) => s.id));

    // Remove stale sessions from layout
    let currentRoot = currentLayout.root;
    for (const id of layoutSessionIds) {
      if (!activeSessionIds.has(id) && currentRoot) {
        currentRoot = removeSessionFromTree(currentRoot, id as SessionId);
      }
    }

    // Find sessions not in layout
    const missing = foreground.filter((s) => !layoutSessionIds.has(s.id));

    if (missing.length === 0 && currentRoot === currentLayout.root) return;

    // Add missing sessions
    if (missing.length > 0) {
      if (!currentRoot) {
        // Build fresh layout
        const newLayout = buildDefaultLayout(foreground);
        setLayout(newLayout);
        return;
      }
      // Append missing sessions to root
      for (const session of missing) {
        const newLeaf: LayoutLeaf = {
          type: 'leaf',
          id: uuid() as LayoutNodeId,
          sessionId: session.id,
        };
        if (currentRoot.type === 'leaf') {
          currentRoot = {
            type: 'split',
            id: uuid() as LayoutNodeId,
            direction: 'vertical',
            children: [currentRoot, newLeaf],
            sizes: [50, 50],
          };
        } else {
          const childCount: number = currentRoot.children.length + 1;
          const evenSize = 100 / childCount;
          const updated: LayoutSplit = {
            type: 'split',
            id: currentRoot.id,
            direction: currentRoot.direction,
            children: [...currentRoot.children, newLeaf],
            sizes: Array(childCount).fill(evenSize) as number[],
          };
          currentRoot = updated;
        }
      }
    }

    setLayout({ root: currentRoot });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, loaded]);

  const splitPane = useCallback(
    (nodeId: LayoutNodeId, direction: 'horizontal' | 'vertical', newSessionId: SessionId) => {
      const current = layoutRef.current;
      if (!current.root) return;
      const newRoot = splitNode(current.root, nodeId, direction, newSessionId);
      setLayout({ root: newRoot });
    },
    [setLayout],
  );

  const closePane = useCallback(
    (nodeId: LayoutNodeId) => {
      const current = layoutRef.current;
      if (!current.root) return;
      const newRoot = removeNode(current.root, nodeId);
      setLayout({ root: newRoot });
    },
    [setLayout],
  );

  const resizePanes = useCallback(
    (splitId: LayoutNodeId, newSizes: number[]) => {
      const current = layoutRef.current;
      if (!current.root) return;
      const newRoot = updateSizes(current.root, splitId, newSizes);
      setLayout({ root: newRoot });
    },
    [setLayout],
  );

  const syncWithSessions = useCallback(
    (_sessions: Session[]) => {
      // Sync is handled by the useEffect above; this is a manual trigger if needed
    },
    [],
  );

  return { layout, splitPane, closePane, resizePanes, syncWithSessions };
}
