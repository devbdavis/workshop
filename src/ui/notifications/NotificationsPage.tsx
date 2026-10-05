import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WorkflowTicket } from '@foundation/types';
import { useSessionAlerts, type SessionAlert } from './SessionAlerts';

const LEGACY_HUMAN_GATE_STATES = new Set([
  'spec-review', 'plan-review', 'final-review', 'needs-input',
  'code-review', 'decomposition-review', 'integration-review',
]);

/** Check if a ticket needs human action (template-aware + legacy fallback) */
function isHumanGate(ticket: WorkflowTicket): boolean {
  const sd = ticket.stateData as Record<string, unknown> | undefined;
  if (sd?.currentStateHumanGate === true) return true;
  return LEGACY_HUMAN_GATE_STATES.has(ticket.state);
}

const GATE_LABELS: Record<string, { label: string; description: string; action: string }> = {
  'spec-review': { label: 'Spec Review', description: 'Specification is ready for your review', action: 'Review Spec' },
  'plan-review': { label: 'Plan Review', description: 'Implementation plan needs your approval', action: 'Review Plan' },
  'decomposition-review': { label: 'Task Decomposition', description: 'Task breakdown needs your approval', action: 'Review Tasks' },
  'code-review': { label: 'Code Review', description: 'Implementation is ready for code review', action: 'Review Code' },
  'integration-review': { label: 'Integration Review', description: 'Full implementation ready for review', action: 'Review Changes' },
  'final-review': { label: 'Final Review', description: 'Implementation is ready for final review', action: 'Review Changes' },
  'needs-input': { label: 'Needs Input', description: 'Agent has questions that need your answers', action: 'Answer Questions' },
};

export function NotificationsPage() {
  const navigate = useNavigate();
  const { unread, open, clearAll } = useSessionAlerts();
  const [workflowItems, setWorkflowItems] = useState<WorkflowTicket[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPending = useCallback(async () => {
    try {
      const wfRes = await fetch('/api/workflow/tickets');
      if (wfRes.ok) {
        const tickets: WorkflowTicket[] = await wfRes.json();
        setWorkflowItems(tickets.filter(isHumanGate));
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
        if (event.type?.startsWith('workflow:')) loadPending();
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, [loadPending]);

  if (loading) {
    return <div className="p-8 text-gray-400">Loading...</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-4 px-6 py-2 border-b border-gray-800 shrink-0">
        <h1 className="text-lg font-semibold">Notifications</h1>
        {workflowItems.length > 0 && (
          <span className="px-2 py-0.5 text-xs font-medium bg-amber-900/60 text-amber-300 rounded-full">
            {workflowItems.length} pending
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {workflowItems.length === 0 && unread.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-4 max-w-3xl">
            {unread.length > 0 && <SessionAlertsSection alerts={unread} onOpen={open} onClearAll={clearAll} />}

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
          </div>
        )}
      </div>
    </div>
  );
}

interface SessionAlertsSectionProps {
  alerts: SessionAlert[];
  onOpen: (alert: SessionAlert) => void;
  onClearAll: () => void;
}

function SessionAlertsSection({ alerts, onOpen, onClearAll }: SessionAlertsSectionProps) {
  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-900/60 border-b border-gray-800">
        <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
        <span className="text-sm font-medium text-gray-200">Sessions — waiting on you</span>
        <span className="text-xs text-gray-500">{alerts.length} item{alerts.length !== 1 ? 's' : ''}</span>
        <button
          onClick={onClearAll}
          className="ml-auto text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Clear
        </button>
      </div>
      <div className="divide-y divide-gray-800/50">
        {alerts.map((alert) => (
          <div key={alert.id} className="px-4 py-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  alert.kind === 'needs-input' ? 'bg-blue-900/50 text-blue-300' : 'bg-amber-900/50 text-amber-300'
                }`}>
                  {alert.kind === 'needs-input' ? 'Needs Input' : 'Idle'}
                </span>
                <span className="text-[10px] text-gray-500">{new Date(alert.timestamp).toLocaleTimeString()}</span>
              </div>
              <p className="text-sm text-gray-200 truncate">
                {alert.sessionName ?? `Session ${alert.sessionId.slice(0, 8)}`}
              </p>
            </div>
            <button
              onClick={() => onOpen(alert)}
              className="shrink-0 px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded transition-colors"
            >
              Go to Session
            </button>
          </div>
        ))}
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
      <p className="text-xs text-gray-600 mt-1">Workflow tickets requiring your review will appear here.</p>
    </div>
  );
}
