import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type {
  WorkflowTicket, WorkflowTransition, Track, Session,
  NeedsInputData, PlanCritiqueData,
  IntegrationReviewData, FinalReviewData,
} from '@foundation/types';
import { WorkflowStateIndicator } from './WorkflowStateIndicator';
import { StateTimeline } from './StateTimeline';
import { HumanGatePanel } from './HumanGatePanel';
import {
  Section, DetailRow, NeedsInputSection,
  FindingsSection, FinalReviewSection, MiniTaskBoard,
} from './EpicDetailSections';

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-900/50 text-red-300',
  high: 'bg-red-900/40 text-red-400',
  medium: 'bg-yellow-900/50 text-yellow-300',
  low: 'bg-gray-800 text-gray-400',
};

const HUMAN_GATES = new Set(['spec-review', 'plan-review', 'final-review']);
const TERMINAL_STATES = new Set(['merged', 'cancelled']);

export function EpicDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<WorkflowTicket | null>(null);
  const [transitions, setTransitions] = useState<WorkflowTransition[]>([]);
  const [childTasks, setChildTasks] = useState<WorkflowTicket[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputAnswers, setInputAnswers] = useState<Record<number, string>>({});

  const loadData = useCallback(async () => {
    if (!id) return;
    try {
      const [ticketRes, transRes, tracksRes, childRes, sessionsRes] = await Promise.all([
        fetch(`/api/workflow/tickets/${id}`),
        fetch(`/api/workflow/tickets/${id}/transitions`),
        fetch('/api/tracks'),
        fetch(`/api/workflow/tickets?parentId=${id}`),
        fetch('/api/sessions'),
      ]);
      if (ticketRes.ok) setTicket(await ticketRes.json());
      if (transRes.ok) setTransitions(await transRes.json());
      if (tracksRes.ok) setTracks(await tracksRes.json());
      if (childRes.ok) setChildTasks(await childRes.json());
      if (sessionsRes.ok) setSessions(await sessionsRes.json());
    } catch (err) {
      console.error('Failed to load epic detail:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  // WebSocket for real-time updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/events`);
    ws.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data);
        if (event.type?.startsWith('workflow:')) loadData();
      } catch { /* ignore */ }
    };
    return () => ws.close();
  }, [loadData]);

  async function handleApprove(comment?: string) {
    if (!id) return;
    await fetch(`/api/workflow/tickets/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    });
    loadData();
  }

  async function handleReject(comment?: string) {
    if (!id) return;
    await fetch(`/api/workflow/tickets/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment }),
    });
    loadData();
  }

  async function handleTransition(toState: string, comment?: string) {
    if (!id) return;
    await fetch(`/api/workflow/tickets/${id}/transition`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toState, comment }),
    });
    loadData();
  }

  async function handleKillSession(sessionId: string, trackId: string) {
    await fetch(`/api/tracks/${trackId}/sessions/${sessionId}`, { method: 'DELETE' });
    loadData();
  }

  async function handleSubmitAnswers() {
    if (!id || !ticket) return;
    const questions = (ticket.stateData as NeedsInputData | undefined)?.pendingQuestions ?? [];
    const answered = questions.map((q, i) => ({
      text: q.text,
      answer: inputAnswers[i] ?? '',
    }));
    await fetch(`/api/workflow/tickets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stateData: { ...ticket.stateData, answers: answered } }),
    });
    await handleTransition('triaging');
  }

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>;
  if (!ticket) return <div className="p-8 text-red-400">Ticket not found.</div>;

  const trackName = ticket.trackId
    ? tracks.find((t) => t.id === ticket.trackId)?.name
    : undefined;
  const sd = ticket.stateData as Record<string, unknown> | undefined;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-4">
        {/* Header */}
        <div className="mb-4">
          <button
            onClick={() => navigate('/workflow')}
            className="text-xs text-gray-500 hover:text-gray-300 mb-2 inline-block"
          >
            &larr; Workflow
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-lg font-semibold text-gray-100">{ticket.title}</h1>
            <WorkflowStateIndicator state={ticket.state} ticketType={ticket.type} size="md" />
            <span className={`text-xs px-2 py-0.5 rounded ${PRIORITY_STYLES[ticket.priority]}`}>
              {ticket.priority}
            </span>
          </div>
          <ActionButtons
            ticket={ticket}
            onApprove={handleApprove}
            onReject={handleReject}
            onTransition={handleTransition}
          />
        </div>

        {/* Human gate panel */}
        {HUMAN_GATES.has(ticket.state) && (
          <HumanGatePanel ticket={ticket} onApprove={handleApprove} onReject={handleReject} />
        )}

        {/* Agent sessions */}
        <AgentSessionsBar ticket={ticket} sessions={sessions} onKill={handleKillSession} />

        {/* Two-column layout */}
        <div className="flex flex-col md:flex-row gap-6">
          {/* Left column (2/3) */}
          <div className="flex-1 min-w-0 space-y-4">
            <Section title="Description">
              <div className="text-sm text-gray-300 whitespace-pre-wrap bg-gray-900/50 rounded p-3">
                {ticket.description || 'No description.'}
              </div>
            </Section>

            {sd?.planDraft != null && (
              <Section title="Plan">
                <div className="text-sm text-gray-300 whitespace-pre-wrap bg-gray-900/50 rounded p-3">
                  {String(sd.planDraft)}
                </div>
              </Section>
            )}

            {ticket.state === 'needs-input' && (
              <NeedsInputSection
                data={sd as unknown as NeedsInputData | undefined}
                answers={inputAnswers}
                onChangeAnswer={(idx, val) =>
                  setInputAnswers((prev) => ({ ...prev, [idx]: val }))
                }
                onSubmit={handleSubmitAnswers}
              />
            )}

            {(ticket.state === 'plan-critique' || ticket.state === 'integration-review') && (
              <FindingsSection
                data={sd as unknown as (PlanCritiqueData | IntegrationReviewData) | undefined}
              />
            )}

            {ticket.state === 'final-review' && sd && (
              <FinalReviewSection data={sd as unknown as FinalReviewData | undefined} />
            )}

            {childTasks.length > 0 && (
              <Section title="Tasks">
                <MiniTaskBoard tasks={childTasks} onClickTask={(t) => navigate(`/workflow/${t.id}`)} />
              </Section>
            )}
          </div>

          {/* Right column (1/3) */}
          <div className="w-full md:w-80 space-y-4 shrink-0">
            <Section title="Status Timeline">
              <StateTimeline transitions={transitions} ticketType={ticket.type} />
            </Section>

            <Section title="Details">
              <dl className="space-y-2 text-xs">
                <DetailRow label="Track" value={trackName ?? 'Unbound'} />
                <DetailRow label="Provider" value={ticket.provider} />
                <DetailRow label="Priority" value={ticket.priority} />
                <DetailRow label="Created" value={new Date(ticket.createdAt).toLocaleString()} />
                <DetailRow label="Last state change" value={new Date(ticket.stateChangedAt).toLocaleString()} />
                {ticket.assignedAgentRole && (
                  <DetailRow label="Agent role" value={ticket.assignedAgentRole} />
                )}
              </dl>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionButtons({ ticket, onApprove, onReject, onTransition }: {
  ticket: WorkflowTicket;
  onApprove: (comment?: string) => void;
  onReject: (comment?: string) => void;
  onTransition: (toState: string, comment?: string) => void;
}) {
  const isTerminal = TERMINAL_STATES.has(ticket.state);
  const isHumanGate = HUMAN_GATES.has(ticket.state);

  return (
    <div className="flex items-center gap-2 mt-2 flex-wrap">
      {isHumanGate && (
        <>
          <button
            onClick={() => onApprove()}
            className="px-3 py-1 text-xs bg-green-800 hover:bg-green-700 text-green-200 rounded transition-colors"
          >
            Approve
          </button>
          <button
            onClick={() => onReject()}
            className="px-3 py-1 text-xs bg-red-900 hover:bg-red-800 text-red-200 rounded transition-colors"
          >
            Reject
          </button>
        </>
      )}
      {ticket.state === 'needs-input' && (
        <button
          onClick={() => onTransition('triaging')}
          className="px-3 py-1 text-xs bg-blue-800 hover:bg-blue-700 text-blue-200 rounded transition-colors"
        >
          Submit Answers
        </button>
      )}
      {ticket.state === 'approved' && (
        <button
          onClick={() => onTransition('merged')}
          className="px-3 py-1 text-xs bg-green-800 hover:bg-green-700 text-green-200 rounded transition-colors"
        >
          Mark Merged
        </button>
      )}
      {!isTerminal && (
        <button
          onClick={() => onTransition('cancelled')}
          className="px-3 py-1 text-xs text-gray-500 hover:text-red-400 border border-gray-700 hover:border-red-800 rounded transition-colors"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

function AgentSessionsBar({ ticket, sessions, onKill }: {
  ticket: WorkflowTicket;
  sessions: Session[];
  onKill: (sessionId: string, trackId: string) => void;
}) {
  // Collect all session IDs associated with this ticket
  const sd = ticket.stateData as Record<string, unknown> | undefined;
  const agentSessionIds = (sd?.agentSessionIds as string[] | undefined) ?? [];
  const execSessionId = ticket.executionSessionId;
  const allIds = new Set([...agentSessionIds, ...(execSessionId ? [execSessionId] : [])]);

  if (allIds.size === 0) return null;

  // Match against live sessions
  const matched = sessions.filter((s) => allIds.has(s.id));
  const alive = matched.filter((s) => s.state === 'active');
  const dead = matched.filter((s) => s.state !== 'active');
  const missing = allIds.size - matched.length;

  if (alive.length === 0 && dead.length === 0 && missing === 0) return null;

  return (
    <div className="border border-gray-800 bg-gray-900 rounded-lg px-4 py-3 mb-4">
      <div className="flex items-center gap-2 mb-2">
        {alive.length > 0 && (
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        )}
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Agent Sessions
          <span className="ml-1.5 text-gray-500 font-normal normal-case">
            ({alive.length} active{dead.length > 0 ? `, ${dead.length} ended` : ''}
            {missing > 0 ? `, ${missing} cleaned up` : ''})
          </span>
        </h3>
      </div>
      <div className="space-y-1.5">
        {alive.map((s) => (
          <div key={s.id} className="flex items-center gap-2 text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            <span className="text-gray-300 font-medium">
              {s.name || s.tmuxSession}
            </span>
            {s.id === execSessionId && (
              <span className="text-[10px] px-1.5 py-0.5 bg-blue-900/50 text-blue-300 rounded">
                executor
              </span>
            )}
            {s.background && (
              <span className="text-[10px] px-1.5 py-0.5 bg-emerald-900/50 text-emerald-400 rounded">
                background
              </span>
            )}
            <span className="text-gray-600 font-mono ml-auto hidden sm:inline">
              tmux attach -t {s.tmuxSession}
            </span>
            <button
              onClick={() => onKill(s.id, s.trackId)}
              className="text-gray-600 hover:text-red-400 transition-colors"
              title="Kill session"
            >
              Kill
            </button>
          </div>
        ))}
        {dead.map((s) => (
          <div key={s.id} className="flex items-center gap-2 text-xs opacity-50">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-600 shrink-0" />
            <span className="text-gray-500">
              {s.name || s.tmuxSession}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-500 rounded">
              ended
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
