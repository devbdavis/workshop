import { useCallback, useEffect, useState } from 'react';
import type { PermissionRequest, PermissionRule } from '@foundation/permission-types';
import { deleteRule, listRequests, listRules, relTime, STATUS_STYLE } from '../permissions/api';

export function PermissionSettings() {
  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [requests, setRequests] = useState<PermissionRequest[]>([]);

  const load = useCallback(() => {
    listRules()
      .then(setRules)
      .catch(() => {});
    listRequests('all', { limit: 50 })
      .then(setRequests)
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function remove(id: string) {
    await deleteRule(id);
    setRules((r) => r.filter((x) => x.id !== id));
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-200 mb-1">Permission rules</h2>
      <p className="text-xs text-gray-500 mb-5">
        The CLI&apos;s own auto mode is consulted first; these rules apply only to what it would
        block.
      </p>

      {rules.length === 0 ? (
        <p className="text-xs text-gray-500 mb-6">
          No rules yet. Use "Always approve" or "Always decline" on a permission request.
        </p>
      ) : (
        <ul className="space-y-1.5 mb-6">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-3 text-xs">
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${r.decision === 'allow' ? STATUS_STYLE.approved : STATUS_STYLE.declined}`}
              >
                {r.decision}
              </span>
              <span className="text-gray-300 shrink-0">{r.toolName}</span>
              <span className="font-mono text-gray-400 truncate flex-1 min-w-0">
                {r.pattern ?? 'any input'}
              </span>
              <button
                onClick={() => remove(r.id)}
                aria-label={`Delete rule ${r.toolName} ${r.pattern ?? 'any input'}`}
                className="text-red-400 hover:text-red-300 shrink-0"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="text-xs font-semibold text-gray-400 mb-1.5">Recent requests</h3>
      <table className="w-full text-xs">
        <tbody>
          {requests.map((r) => (
            <tr key={r.id} className="border-t border-gray-800">
              <td className="py-1 pr-2 text-gray-500 whitespace-nowrap">{relTime(r.createdAt)}</td>
              <td className="py-1 pr-2 text-gray-300 max-w-[8rem] truncate">{r.taskName}</td>
              <td className="py-1 pr-2 text-gray-400">{r.normalizedTool}</td>
              <td
                className="py-1 pr-2 font-mono text-gray-400 max-w-0 w-full truncate"
                title={r.summary}
              >
                {r.summary}
              </td>
              <td className="py-1">
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${STATUS_STYLE[r.status]}`}>
                  {r.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
