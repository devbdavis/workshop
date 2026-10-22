import type {
  PermissionDecision,
  PermissionRequest,
  PermissionRequestStatus,
  PermissionRule,
} from '@foundation/permission-types';

export async function listRequests(
  status: 'pending' | 'all',
  opts: { toolName?: string; limit?: number } = {},
): Promise<PermissionRequest[]> {
  const q = new URLSearchParams({ status });
  if (opts.toolName) q.set('toolName', opts.toolName);
  if (opts.limit) q.set('limit', String(opts.limit));
  const res = await fetch(`/api/permissions/requests?${q}`);
  return res.ok ? ((await res.json()) as PermissionRequest[]) : [];
}

/** True when the request is settled (decided now, or already decided/expired/unknown). */
export async function decide(
  id: string,
  body: { decision: PermissionDecision; always: boolean; pattern: string | null },
): Promise<boolean> {
  const res = await fetch(`/api/permissions/requests/${id}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok || res.status === 409 || res.status === 404;
}

export async function listRules(): Promise<PermissionRule[]> {
  const res = await fetch('/api/permissions/rules');
  return res.ok ? ((await res.json()) as PermissionRule[]) : [];
}

export async function deleteRule(id: string): Promise<void> {
  await fetch(`/api/permissions/rules/${id}`, { method: 'DELETE' });
}

export function relTime(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const STATUS_STYLE: Record<PermissionRequestStatus, string> = {
  pending: 'bg-blue-900/40 text-blue-300',
  approved: 'bg-emerald-900/40 text-emerald-300',
  'auto-approved': 'bg-emerald-900/40 text-emerald-300',
  declined: 'bg-red-900/40 text-red-300',
  'auto-declined': 'bg-red-900/40 text-red-300',
  expired: 'bg-gray-800 text-gray-400',
};
