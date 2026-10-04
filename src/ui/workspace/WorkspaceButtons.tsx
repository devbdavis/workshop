import { useEffect, useState } from 'react';
import { WorkspaceBrowser } from './WorkspaceBrowser';

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

interface Props {
  sessionId: string;
  editorPath?: string;
}

/** "Files" + "VS Code" header buttons for a session pane. */
export function WorkspaceButtons({ sessionId, editorPath }: Props) {
  const [showBrowser, setShowBrowser] = useState(false);
  const codeServerReady = useCodeServerAvailable();

  if (!editorPath) return null;

  return (
    <>
      <button
        onClick={() => setShowBrowser(true)}
        className="flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-blue-400 px-1"
        title="Browse and edit workspace files (in browser)"
      >
        <FolderIcon className="w-3.5 h-3.5" />
        <span>Files</span>
      </button>
      {codeServerReady && (
        <button
          onClick={() => openInVsCode(sessionId, editorPath)}
          className="flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-blue-400 px-1"
          title="Open VS Code in the browser (runs on the Workshop server)"
        >
          <GlobeIcon className="w-3.5 h-3.5" />
          <span>VS Code</span>
        </button>
      )}
      {showBrowser && <WorkspaceBrowser sessionId={sessionId} onClose={() => setShowBrowser(false)} />}
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
