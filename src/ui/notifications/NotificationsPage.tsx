import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { PermissionRequest, WorkflowTicket } from '@foundation/types';

/** Permission request enriched with track/session context */
interface EnrichedPermission extends PermissionRequest {
  trackId?: string;
  trackName: string;
  sessionName: string;
}

const HUMAN_GATE_STATES = ['spec-review', 'plan-review', 'final-review', 'needs-input'];

const GATE_LABELS: Record<string, { label: string; description: string; action: string }> = {
  'spec-review': { label: 'Spec Review', description: 'Specification is ready for your review', action: 'Review Spec' },
  'plan-review': { label: 'Plan Review', description: 'Implementation plan needs your approval', action: 'Review Plan' },
  'final-review': { label: 'Final Review', description: 'Implementation is ready for final review', action: 'Review Changes' },
  'needs-input': { label: 'Needs Input', description: 'Agent has questions that need your answers', action: 'Answer Questions' },
};

export function NotificationsPage() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<EnrichedPermission[]>([]);
  const [workflowItems, setWorkflowItems] = useState<WorkflowTicket[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPending = useCallback(async () => {
    try {
      const [permRes, wfRes] = await Promise.all([
        fetch('/api/permissions/pending'),
        fetch('/api/workflow/tickets'),
      ]);
      if (permRes.ok) setRequests(await permRes.json());
      if (wfRes.ok) {
        const tickets: WorkflowTicket[] = await wfRes.json();
        setWorkflowItems(tickets.filter((t) => HUMAN_GATE_STATES.includes(t.state)));
      }
    } catch (err) {
      console.error('Failed to load pending items:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  // WebSocket for real-time updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data);
        if (event.type?.startsWith('permission:') || event.type?.startsWith('workflow:')) loadPending();
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, [loadPending]);

  const totalPending = requests.length + workflowItems.length;

  async function resolve(id: string, decision: 'approved' | 'denied', comment?: string) {
    await fetch(`/api/permissions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, comment }),
    });
    loadPending();
  }

  async function allowAllForSession(sessionId: string) {
    await fetch(`/api/permissions/sessions/${sessionId}/auto-approve`, { method: 'POST' });
    loadPending();
  }

  // Group by track
  const grouped = groupByTrack(requests);

  if (loading) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-4 px-6 py-2 border-b border-gray-800 shrink-0">
        <h1 className="text-lg font-semibold">Notifications</h1>
        {totalPending > 0 && (
          <span className="px-2 py-0.5 text-xs font-medium bg-amber-900/60 text-amber-300 rounded-full">
            {totalPending} pending
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {totalPending === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-4 max-w-3xl">
            {/* Workflow items needing human action */}
            {workflowItems.length > 0 && (
              <div className="border border-gray-800 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 bg-gray-900/60 border-b border-gray-800">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-sm font-medium text-gray-200">Workflow — Action Required</span>
                  <span className="text-xs text-gray-500">{workflowItems.length} item{workflowItems.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="divide-y divide-gray-800/50">
                  {workflowItems.map((ticket) => {
                    const gate = GATE_LABELS[ticket.state] || { label: ticket.state, description: '', action: 'View' };
                    return (
                      <div key={ticket.id} className="px-4 py-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              ticket.state === 'needs-input'
                                ? 'bg-blue-900/50 text-blue-300'
                                : 'bg-amber-900/50 text-amber-300'
                            }`}>
                              {gate.label}
                            </span>
                            <span className="text-[10px] text-gray-500 uppercase">{ticket.type}</span>
                          </div>
                          <p className="text-sm text-gray-200 truncate">{ticket.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{gate.description}</p>
                        </div>
                        <button
                          onClick={() => navigate(`/workflow/${ticket.id}`)}
                          className="shrink-0 px-3 py-1.5 text-xs bg-amber-700 hover:bg-amber-600 text-white rounded transition-colors"
                        >
                          {gate.action}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Permission requests */}
            {grouped.map(({ trackId, trackName, items }) => (
              <TrackGroup
                key={trackId ?? 'unknown'}
                trackId={trackId}
                trackName={trackName}
                requests={items}
                onResolve={resolve}
                onAllowAllForSession={allowAllForSession}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-gray-500">
      <svg className="w-12 h-12 mb-3 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
      <p className="text-sm">No pending approvals</p>
      <p className="text-xs text-gray-600 mt-1">Permission requests from background sessions will appear here.</p>
    </div>
  );
}

interface TrackGroupProps {
  trackId?: string;
  trackName: string;
  requests: EnrichedPermission[];
  onResolve: (id: string, decision: 'approved' | 'denied', comment?: string) => void;
  onAllowAllForSession: (sessionId: string) => void;
}

function TrackGroup({ trackId, trackName, requests, onResolve, onAllowAllForSession }: TrackGroupProps) {
  const sessionIds = [...new Set(requests.map((r) => r.sessionId))];

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-900/60 border-b border-gray-800">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        {trackId ? (
          <Link to={`/tracks/${trackId}`} className="text-sm font-medium text-gray-200 hover:text-white transition-colors">
            {trackName}
          </Link>
        ) : (
          <span className="text-sm font-medium text-gray-200">{trackName}</span>
        )}
        <span className="text-xs text-gray-500">
          {requests.length} request{requests.length !== 1 ? 's' : ''}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {sessionIds.map((sid) => (
            <button
              key={sid}
              onClick={() => onAllowAllForSession(sid)}
              className="px-2 py-0.5 text-[11px] bg-amber-800/60 hover:bg-amber-700/60 text-amber-200 rounded transition-colors"
              title={`Auto-approve all tool use for session ${sid.slice(0, 8)}`}
            >
              Allow all{sessionIds.length > 1 ? ` (${sid.slice(0, 8)})` : ''}
            </button>
          ))}
        </div>
      </div>
      <div className="divide-y divide-gray-800/50">
        {requests.map((req) => (
          <NotificationCard key={req.id} request={req} onResolve={onResolve} />
        ))}
      </div>
    </div>
  );
}

function NotificationCard({
  request,
  onResolve,
}: {
  request: EnrichedPermission;
  onResolve: (id: string, decision: 'approved' | 'denied', comment?: string) => void;
}) {
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);

  const toolDisplay = formatToolDisplay(request.toolName, request.toolInput);
  const age = formatAge(request.createdAt);

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-amber-300">{request.toolName}</span>
            <span className="text-[10px] text-gray-500">{request.sessionName}</span>
            <span className="text-[10px] text-gray-600">{age}</span>
          </div>
          <pre className="text-xs text-gray-300 bg-gray-900/80 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-32 overflow-y-auto font-mono">
            {toolDisplay}
          </pre>
        </div>
      </div>

      {showComment && (
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional comment for the agent..."
          className="w-full mt-2 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-gray-300"
          rows={2}
          autoFocus
        />
      )}

      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={() => onResolve(request.id, 'approved', comment || undefined)}
          className="px-2.5 py-1 text-xs bg-green-800 hover:bg-green-700 text-green-200 rounded transition-colors"
        >
          Approve
        </button>
        <button
          onClick={() => onResolve(request.id, 'denied', comment || undefined)}
          className="px-2.5 py-1 text-xs bg-red-900 hover:bg-red-800 text-red-200 rounded transition-colors"
        >
          Deny
        </button>
        <button
          onClick={() => setShowComment(!showComment)}
          className="px-2.5 py-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
        >
          {showComment ? 'Hide comment' : 'Comment'}
        </button>
      </div>
    </div>
  );
}

/** Group requests by track, preserving order */
function groupByTrack(requests: EnrichedPermission[]) {
  const map = new Map<string, { trackId?: string; trackName: string; items: EnrichedPermission[] }>();
  for (const req of requests) {
    const key = req.trackId ?? 'unknown';
    if (!map.has(key)) {
      map.set(key, { trackId: req.trackId, trackName: req.trackName, items: [] });
    }
    map.get(key)!.items.push(req);
  }
  return [...map.values()];
}

/** Format tool input for display */
function formatToolDisplay(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'Bash' && input.command) return String(input.command);
  if ((toolName === 'Edit' || toolName === 'Write') && input.file_path) {
    const filePath = String(input.file_path);
    if (toolName === 'Write') {
      const content = String(input.content || '').slice(0, 200);
      return `${filePath}\n\n${content}${String(input.content || '').length > 200 ? '...' : ''}`;
    }
    const oldStr = String(input.old_string || '').slice(0, 100);
    const newStr = String(input.new_string || '').slice(0, 100);
    return `${filePath}\n- ${oldStr}\n+ ${newStr}`;
  }
  return JSON.stringify(input, null, 2);
}

/** Human-readable age from ISO timestamp */
function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}
