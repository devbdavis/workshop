import { useCallback, useEffect, useRef, useState } from 'react';
import { PickTray, type PickItem } from './PickTray';

export interface Pick {
  selector: string;
  url: string;
  tag: string;
  text: string;
  outerHTML: string;
  parentHTML: string;
  styles: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  source: string | null;
  viewport: { width: number; height: number };
}

interface PreviewStatus {
  port: number;
  screenshots: boolean;
}

/** Checked on every open: the screenshot sidecar may have been started since. */
function fetchPreviewStatus(): Promise<PreviewStatus | null> {
  return fetch('/api/preview/status')
    .then((r) => (r.ok ? (r.json() as Promise<PreviewStatus>) : null))
    .catch(() => null);
}

function isRect(v: unknown): v is Pick['rect'] {
  return typeof v === 'object' && v !== null && ['x', 'y', 'width', 'height'].every((k) => typeof (v as Record<string, unknown>)[k] === 'number');
}

function isViewport(v: unknown): v is Pick['viewport'] {
  return typeof v === 'object' && v !== null && ['width', 'height'].every((k) => typeof (v as Record<string, unknown>)[k] === 'number');
}

/** Narrow unknown postMessage data down to a Pick before trusting it. */
function isPick(v: unknown): v is Pick {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.selector === 'string' &&
    typeof p.url === 'string' &&
    typeof p.tag === 'string' &&
    typeof p.text === 'string' &&
    typeof p.outerHTML === 'string' &&
    typeof p.parentHTML === 'string' &&
    typeof p.styles === 'object' && p.styles !== null &&
    isRect(p.rect) &&
    (p.source === null || typeof p.source === 'string') &&
    isViewport(p.viewport)
  );
}

interface Props {
  sessionId: string;
  onClose: () => void;
}

const MAX_PICKS = 10;

export function DesignPreview({ sessionId, onClose }: Props) {
  const storageKey = `workshop.preview.target.${sessionId}`;
  const [status, setStatus] = useState<PreviewStatus | null | undefined>(undefined);
  const [targetInput, setTargetInput] = useState(() => readStoredTarget(storageKey));
  const [pathInput, setPathInput] = useState('/');
  const [loaded, setLoaded] = useState(() => ({ target: targetInput, path: '/' }));
  const [reloadNonce, setReloadNonce] = useState(0);
  const [pickMode, setPickMode] = useState(false);
  const [picks, setPicks] = useState<PickItem[]>([]);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    fetchPreviewStatus().then(setStatus);
  }, []);

  const previewOrigin = status ? `${location.protocol}//${location.hostname}:${status.port}` : null;
  const atLimit = picks.length >= MAX_PICKS;

  const go = useCallback(() => {
    try { window.localStorage.setItem(storageKey, targetInput); } catch { /* storage unavailable */ }
    setLoaded({ target: targetInput, path: pathInput });
    setReloadNonce((n) => n + 1);
  }, [storageKey, targetInput, pathInput]);

  const setPickModeAndNotify = useCallback((on: boolean) => {
    setPickMode(on);
    if (previewOrigin) iframeRef.current?.contentWindow?.postMessage({ type: 'workshop:pick-mode', on }, previewOrigin);
  }, [previewOrigin]);

  // Auto-disable once the tray is full — matches the "disable picking beyond 10" requirement.
  useEffect(() => {
    if (atLimit && pickMode) setPickModeAndNotify(false);
  }, [atLimit, pickMode, setPickModeAndNotify]);

  const shootPick = useCallback(async (id: string, pick: Pick) => {
    if (!loaded || !status?.screenshots) return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/preview/shot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: loaded.target, url: pick.url, selector: pick.selector, width: pick.viewport.width, height: pick.viewport.height }),
      });
      if (!res.ok) throw new Error('shot failed');
      const data = (await res.json()) as { file: string; dataUrl: string };
      setPicks((ps) => ps.map((p) => (p.id === id ? { ...p, shotStatus: 'done', shotDataUrl: data.dataUrl, shotFile: data.file } : p)));
    } catch {
      setPicks((ps) => ps.map((p) => (p.id === id ? { ...p, shotStatus: 'error' } : p)));
    }
  }, [loaded, sessionId, status]);

  useEffect(() => {
    function onMessage(e: MessageEvent): void {
      if (!previewOrigin || e.origin !== previewOrigin) return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data as unknown;
      if (typeof data !== 'object' || data === null) return;
      const msg = data as Record<string, unknown>;
      if (msg.type === 'workshop:pick-mode' && msg.on === false) {
        setPickMode(false);
        return;
      }
      if (msg.type === 'workshop:pick' && isPick(msg.pick)) {
        if (picks.length >= MAX_PICKS) return;
        const id = crypto.randomUUID();
        const pick = msg.pick;
        setPicks((ps) => [...ps, { id, pick, shotStatus: status?.screenshots ? 'loading' : 'none' }]);
        if (status?.screenshots) shootPick(id, pick);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [previewOrigin, picks.length, status, shootPick]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      if (pickMode) setPickModeAndNotify(false);
      else onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickMode, onClose, setPickModeAndNotify]);

  function onIframeLoad(): void {
    if (previewOrigin) iframeRef.current?.contentWindow?.postMessage({ type: 'workshop:pick-mode', on: pickMode }, previewOrigin);
  }

  async function send(): Promise<void> {
    if (!loaded || picks.length === 0 || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/preview/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: loaded.target,
          note: note.trim() || undefined,
          picks: picks.map((p) => ({ ...p.pick, screenshot: p.shotFile })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: true; file?: string; error?: string };
      if (!res.ok) {
        setSendError(res.status === 409 ? 'Session is not running' : body.error ?? 'Failed to send');
        return;
      }
      setSendMessage('Sent to agent');
      setPicks([]);
      setNote('');
    } catch {
      setSendError('Failed to send');
    } finally {
      setSending(false);
    }
  }

  const iframeSrc = previewOrigin && loaded ? `${previewOrigin}/__workshop/start?target=${encodeURIComponent(loaded.target)}&path=${encodeURIComponent(loaded.path)}` : null;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-2 md:p-6" onClick={(e) => { if (e.target === e.currentTarget && !pickMode) onClose(); }}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-full h-full max-w-6xl flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800 shrink-0">
          <span className="text-sm text-gray-200 shrink-0">Preview</span>
          <input
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
            placeholder="http://localhost:5173"
            className="flex-1 min-w-0 bg-gray-950 border border-gray-700 rounded text-xs text-gray-200 px-2 py-1 outline-none font-mono"
          />
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
            placeholder="/"
            className="w-28 shrink-0 bg-gray-950 border border-gray-700 rounded text-xs text-gray-200 px-2 py-1 outline-none font-mono"
          />
          <button onClick={go} className="text-xs text-gray-300 hover:text-blue-400 border border-gray-700 rounded px-2 py-1 shrink-0">Go</button>
          <button onClick={() => setReloadNonce((n) => n + 1)} className="text-xs text-gray-300 hover:text-blue-400 border border-gray-700 rounded px-2 py-1 shrink-0">Reload</button>
          <button
            onClick={() => setPickModeAndNotify(!pickMode)}
            disabled={atLimit && !pickMode}
            aria-pressed={pickMode}
            className={`text-xs rounded px-2 py-1 shrink-0 border ${pickMode ? 'bg-blue-900/60 text-blue-200 border-blue-700' : 'text-gray-300 border-gray-700 hover:text-blue-400'} disabled:opacity-40`}
          >
            Pick
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-xl leading-none px-1 shrink-0">×</button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {status === undefined ? (
            <div className="flex-1 p-4 text-xs text-gray-500">Loading…</div>
          ) : status === null ? (
            <div className="flex-1 p-4 text-xs text-gray-500">Preview is unavailable — the Workshop server did not report a preview port.</div>
          ) : (
            <>
              {iframeSrc && (
                <iframe
                  key={reloadNonce}
                  ref={iframeRef}
                  src={iframeSrc}
                  onLoad={onIframeLoad}
                  title="App preview"
                  className="flex-1 bg-white border-0"
                />
              )}
              <PickTray
                picks={picks}
                onRemove={(id) => setPicks((ps) => ps.filter((p) => p.id !== id))}
                note={note}
                onNoteChange={setNote}
                onSend={send}
                sending={sending}
                sendMessage={sendMessage}
                sendError={sendError}
                atLimit={atLimit}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function readStoredTarget(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? 'http://localhost:5173';
  } catch {
    return 'http://localhost:5173';
  }
}
