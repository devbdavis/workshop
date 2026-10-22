import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PermissionDecision, PermissionRequest } from '@foundation/permission-types';
import { decide, listRequests } from './api';
import { PermissionHistory } from './PermissionHistory';

/** Global modal for the oldest pending permission request. Escape minimises; it never decides. */
export function PermissionPrompt() {
  const [pending, setPending] = useState<PermissionRequest[]>([]);
  const [minimised, setMinimised] = useState(false);
  const [pattern, setPattern] = useState('');
  const navigate = useNavigate();
  const approveRef = useRef<HTMLButtonElement>(null);

  const remove = useCallback((id: string) => setPending((p) => p.filter((r) => r.id !== id)), []);

  useEffect(() => {
    let cancelled = false;
    listRequests('pending')
      .then((r) => {
        if (cancelled) return;
        // Oldest first; merge with anything the socket delivered meanwhile.
        setPending((prev) => {
          const ids = new Set(prev.map((p) => p.id));
          return [...prev, ...r.filter((x) => !ids.has(x.id))].sort((a, b) =>
            a.createdAt.localeCompare(b.createdAt),
          );
        });
      })
      .catch(() => {});

    let ws: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    function connect() {
      if (cancelled) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
      ws.onmessage = (evt) => {
        try {
          const ev = JSON.parse(evt.data) as { type: string; request?: PermissionRequest };
          if (!ev.request) return;
          if (ev.type === 'permission:requested') {
            const req = ev.request;
            setPending((p) => (p.some((x) => x.id === req.id) ? p : [...p, req]));
            setMinimised(false);
          } else if (ev.type === 'permission:decided') {
            remove(ev.request.id);
          }
        } catch {
          // ignore malformed messages
        }
      };
      ws.onclose = () => {
        if (!cancelled) timer = setTimeout(connect, 2_000);
      };
    }
    connect();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [remove]);

  const current = pending[0];
  const currentId = current?.id;
  const suggested = current?.suggestedPattern ?? '';
  useEffect(() => {
    setPattern(suggested);
  }, [currentId, suggested]);

  useEffect(() => {
    if (!currentId || minimised) return;
    approveRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMinimised(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentId, minimised]);

  if (!current) return null;

  async function submit(decision: PermissionDecision, always: boolean) {
    const req = current!;
    const isShell = req.normalizedTool === 'shell';
    // Keep the prompt on network/server errors so the decision can be retried.
    const settled = await decide(req.id, {
      decision,
      always,
      pattern: always && isShell ? pattern.trim() : null,
    }).catch(() => false);
    if (settled) remove(req.id);
  }

  if (minimised) {
    return (
      <button
        type="button"
        onClick={() => setMinimised(false)}
        className="fixed bottom-4 left-4 z-50 px-3 py-2 text-sm bg-amber-900/70 border border-amber-700 text-amber-100 rounded-lg shadow-lg hover:bg-amber-900"
      >
        {pending.length} permission request{pending.length === 1 ? '' : 's'}
      </button>
    );
  }

  const isShell = current.normalizedTool === 'shell';
  const btn = 'px-3 py-1.5 text-xs font-medium rounded';
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="perm-title"
        className="bg-gray-900 border border-gray-700 rounded-lg w-[560px] max-w-full max-h-full overflow-y-auto p-5 space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="perm-title" className="text-sm font-semibold text-gray-100">
              {current.taskName} wants permission
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {current.harness} · {current.toolName}
            </p>
          </div>
          {pending.length > 1 && (
            <span className="text-xs text-gray-500 shrink-0">1 of {pending.length}</span>
          )}
        </div>

        <pre className="bg-gray-950 border border-gray-800 rounded p-3 text-xs font-mono text-gray-200 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
          {current.summary}
        </pre>

        {current.reason && (
          <p className="text-xs text-amber-300/90">
            <span className="text-gray-500">CLI blocked this: </span>
            {current.reason}
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            setMinimised(true);
            navigate(`/sessions?session=${current.sessionId}`);
          }}
          className="text-xs text-blue-400 hover:underline"
        >
          Open session
        </button>

        <PermissionHistory request={current} />

        {isShell ? (
          <label className="block text-xs text-gray-400">
            Rule matches commands starting with
            <input
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm font-mono text-gray-200 focus:outline-none focus:border-blue-500"
            />
          </label>
        ) : (
          <p className="text-xs text-gray-500">Always applies to any {current.toolName} call</p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            ref={approveRef}
            onClick={() => submit('allow', false)}
            className={`${btn} bg-emerald-900/50 text-emerald-200 hover:bg-emerald-900/80`}
          >
            Approve
          </button>
          <button
            onClick={() => submit('allow', true)}
            disabled={isShell && !pattern.trim()}
            className={`${btn} bg-emerald-900/50 text-emerald-200 hover:bg-emerald-900/80 disabled:opacity-40`}
          >
            Always approve
          </button>
          <button
            onClick={() => submit('deny', false)}
            className={`${btn} bg-red-900/50 text-red-300 hover:bg-red-900/70`}
          >
            Decline
          </button>
          <button
            onClick={() => submit('deny', true)}
            disabled={isShell && !pattern.trim()}
            className={`${btn} bg-red-900/50 text-red-300 hover:bg-red-900/70 disabled:opacity-40`}
          >
            Always decline
          </button>
        </div>
        <p className="text-[11px] text-gray-600">Esc minimises this dialog without deciding.</p>
      </div>
    </div>
  );
}
