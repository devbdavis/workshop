import { useEffect, useState, type ReactNode } from 'react';
import { WorkspaceBrowser } from './WorkspaceBrowser';
import { PrDiffModal } from './PrDiffModal';
import type { PullRequest } from '@foundation/types';

let codeServerAvailable: Promise<boolean> | null = null;

/** Fetched once per page load — code-server availability doesn't change at runtime. */
function fetchCodeServerAvailable(): Promise<boolean> {
  if (!codeServerAvailable) {
    codeServerAvailable = fetch('/api/code-server/status')
      .then((r) => (r.ok ? (r.json() as Promise<{ available: boolean }>) : { available: false }))
      .then((d) => d.available)
      .catch(() => false);
  }
  return codeServerAvailable;
}

export function useCodeServerAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchCodeServerAvailable().then((a) => { if (!cancelled) setAvailable(a); });
    return () => { cancelled = true; };
  }, []);
  return available;
}

/** Resolves the editor target (may be a .code-workspace) and hands off to the code-server tab. */
export async function openInVsCode(sessionId: string, editorPath: string): Promise<void> {
  // Open the tab synchronously (before the fetch) so browsers don't treat it as a popup.
  // No 'noopener' here: it makes window.open return null, leaving nothing to navigate.
  const tab = window.open('about:blank', '_blank');
  try {
    const qs = new URLSearchParams({ path: editorPath, sessionId });
    const res = await fetch(`/api/shell/resolve-editor-target?${qs}`);
    if (!res.ok) throw new Error('Failed to resolve editor target');
    const { path: target } = (await res.json()) as { path: string };
    const param = target.endsWith('.code-workspace') ? 'workspace' : 'folder';
    if (tab) tab.location.href = `/code/?${param}=${encodeURIComponent(target)}`;
  } catch {
    tab?.close();
  }
}

async function fetchDevServerUrl(sessionId: string): Promise<string | null> {
  const res = await fetch(`/api/sessions/${sessionId}/dev-server`);
  if (!res.ok) throw new Error('Failed to get dev server url');
  return ((await res.json()) as { url: string | null }).url;
}

/** Fetches a fresh sign-in ticket per click, so the tab is opened first to avoid popup blockers. */
export async function openDevServer(sessionId: string): Promise<void> {
  const tab = window.open('about:blank', '_blank');
  try {
    const url = await fetchDevServerUrl(sessionId);
    if (!url) throw new Error('Dev server unavailable');
    if (tab) {
      // Pre-opened without noopener (needed for the handle), so cut the link before loading the untrusted app.
      tab.opener = null;
      tab.location.href = url;
    }
  } catch {
    tab?.close();
  }
}

interface Props {
  sessionId: string;
  editorPath?: string;
  /** Extra in-Workshop buttons (e.g. the in-browser shell) shown inside the same group. */
  children?: ReactNode;
  todoId?: string;
  pullRequests?: PullRequest[];
}

/** Outlined group of tools that open inside Workshop, kept visually apart from local-app launchers. */
export function WorkspaceButtons({ sessionId, editorPath, children, todoId, pullRequests }: Props) {
  const [showBrowser, setShowBrowser] = useState(false);
  const [showPrDiff, setShowPrDiff] = useState(false);
  const codeServerReady = useCodeServerAvailable();
  const [hasDevServer, setHasDevServer] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchDevServerUrl(sessionId)
      .then((url) => { if (!cancelled) setHasDevServer(url !== null); })
      .catch(() => { if (!cancelled) setHasDevServer(false); });
    return () => { cancelled = true; };
  }, [sessionId]);

  const hasPrs = !!todoId && !!pullRequests?.length;
  if (!editorPath && !children && !hasPrs && !hasDevServer) return null;

  return (
    <>
      <div className="flex items-center rounded border border-gray-700 bg-gray-800/50" title="Opens inside Workshop, in this browser">
        {editorPath && (
          <button
            onClick={() => setShowBrowser(true)}
            className="flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-blue-400 px-1"
            title="Browse and edit workspace files (in browser)"
          >
            <FolderIcon className="w-3.5 h-3.5" />
            <span>Files</span>
          </button>
        )}
        {editorPath && codeServerReady && (
          <button
            onClick={() => openInVsCode(sessionId, editorPath)}
            className="flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-blue-400 px-1"
            title="Open VS Code in the browser (runs on the Workshop server)"
          >
            <GlobeIcon className="w-3.5 h-3.5" />
            <span>Web VS Code</span>
          </button>
        )}
        {hasDevServer && (
          <button
            onClick={() => openDevServer(sessionId)}
            className="flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-blue-400 px-1"
            title="Open this session's dev server in a new tab"
            aria-label="Open dev server"
          >
            <PlayIcon className="w-3.5 h-3.5" />
            <span>Dev Server</span>
          </button>
        )}
        {hasPrs && (
          <button
            onClick={() => setShowPrDiff(true)}
            className="flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-blue-400 px-1"
            title="View the diffs of this session's pull requests"
          >
            <span>PR Diff</span>
          </button>
        )}
        {children}
      </div>
      {showBrowser && <WorkspaceBrowser sessionId={sessionId} onClose={() => setShowBrowser(false)} />}
      {showPrDiff && todoId && pullRequests && <PrDiffModal todoId={todoId} pullRequests={pullRequests} onClose={() => setShowPrDiff(false)} />}
    </>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}
