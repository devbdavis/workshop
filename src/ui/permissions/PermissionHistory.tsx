import { useEffect, useState } from 'react';
import type { PermissionRequest } from '@foundation/permission-types';
import { listRequests, relTime, STATUS_STYLE } from './api';

export function PermissionHistory({ request }: { request: PermissionRequest }) {
  const [rows, setRows] = useState<PermissionRequest[] | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    listRequests('all', { toolName: request.normalizedTool, limit: 8 })
      .then((r) => {
        if (live) setRows(r.filter((x) => x.id !== request.id));
      })
      .catch(() => {
        if (live) setRows([]);
      });
    return () => {
      live = false;
    };
  }, [request.id, request.normalizedTool]);

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 mb-1.5">History</h3>
      {rows === null ? (
        <p className="text-xs text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-500">No previous requests for this tool</p>
      ) : (
        <ul className="space-y-1 max-h-32 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-xs">
              <span className="text-gray-500 w-14 shrink-0">{relTime(r.createdAt)}</span>
              <span className="text-gray-300 shrink-0 max-w-[7rem] truncate">{r.taskName}</span>
              <span className="font-mono text-gray-400 truncate flex-1 min-w-0" title={r.summary}>
                {r.summary}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${STATUS_STYLE[r.status]}`}
              >
                {r.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
