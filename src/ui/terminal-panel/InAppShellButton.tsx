import { useEffect, useRef, useState } from 'react';
import { TerminalModal } from '../track-view/TerminalModal';

function closeShell(id: string): void {
  // keepalive so the tmux shell is still killed when this fires during page unload.
  fetch(`/api/shell/terminal/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {});
}

/** `>_` button that opens a throwaway shell at `cwd` in a floating terminal; closing it kills the shell. */
export function InAppShellButton({ cwd }: { cwd: string }) {
  const [shellId, setShellId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const shellIdRef = useRef<string | null>(null);
  shellIdRef.current = shellId;

  useEffect(() => () => { if (shellIdRef.current) closeShell(shellIdRef.current); }, []);

  async function open(): Promise<void> {
    if (shellId || opening) return;
    setOpening(true);
    try {
      const res = await fetch('/api/shell/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd }),
      });
      if (res.ok) setShellId(((await res.json()) as { id: string }).id);
    } finally {
      setOpening(false);
    }
  }

  function close(): void {
    if (shellId) closeShell(shellId);
    setShellId(null);
  }

  return (
    <>
      <button
        onClick={open}
        disabled={opening}
        className="text-[10px] text-gray-500 hover:text-green-400 px-1 font-mono disabled:opacity-50"
        title={`Open a shell in the browser: ${cwd}`}
      >
        &gt;_
      </button>
      {shellId && <TerminalModal wsPath={`/ws/auth/${shellId}/terminal`} title={cwd} onClose={close} />}
    </>
  );
}
