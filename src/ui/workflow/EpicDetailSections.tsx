import { useMemo } from 'react';
import Markdown from 'react-markdown';
import type { WorkflowTicket, Session } from '@foundation/types.js';

// State-specific data interfaces — now defined locally (runtime validated by stateData shape)
interface NeedsInputData {
  pendingQuestions?: Array<{ text: string }>;
  answers?: Array<{ text: string; answer: string }>;
}

interface PlanCritiqueData {
  findings?: Array<{ text: string; severity: string; resolved?: boolean }>;
}

interface IntegrationReviewData {
  findings?: Array<{ text: string; severity: string; resolved?: boolean }>;
}

interface FinalReviewData {
  prLinks?: string[];
  reviewNotes?: string;
}
import { WorkflowStateIndicator } from './WorkflowStateIndicator';

/** Fallback ordering for known task states. Dynamic states sort after these. */
const STATE_ORDER: Record<string, number> = {
  blocked: 0, waiting: 1, ready: 2, 'in-progress': 3, implementing: 3,
  'code-review': 4, 'changes-requested': 5, done: 6, cancelled: 7,
};

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-800 bg-gray-900 rounded-lg p-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
        {title}
      </h3>
      {children}
    </div>
  );
}

export function CollapsibleSection({ title, children, defaultOpen = false, badge }: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}) {
  return (
    <details
      open={defaultOpen || undefined}
      className="border border-gray-800 bg-gray-900 rounded-lg group"
    >
      <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-300 transition-colors">
        <span className="text-gray-600 group-open:rotate-90 transition-transform text-[10px]">&#9654;</span>
        {title}
        {badge && (
          <span className="text-[10px] px-1.5 py-0.5 bg-blue-900/50 text-blue-400 rounded font-normal normal-case">
            {badge}
          </span>
        )}
      </summary>
      <div className="px-4 pb-4">
        {children}
      </div>
    </details>
  );
}

export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-300">{value}</dd>
    </div>
  );
}

/**
 * Extract numbered questions from a transition comment when stateData.pendingQuestions
 * is not available (fallback for agents that put questions in the comment).
 * Handles formats: "1. q?", "2) q?", "- q?", "(1) q", multi-line and inline.
 */
function parseQuestionsFromComment(comment?: string): Array<{ text: string }> {
  if (!comment) return [];
  const questions: Array<{ text: string }> = [];

  // Try line-by-line first (numbered/bulleted lists)
  for (const line of comment.split('\n')) {
    const m = line.match(/^\s*(?:\d+[.)]\s*|-\s+)(.{10,})/);
    if (m) questions.push({ text: m[1].trim() });
  }
  if (questions.length > 0) return questions;

  // Try inline parenthesized numbers: (1) ... (2) ...
  const inlineMatches = comment.match(/\(\d+\)\s*([^(]+)/g);
  if (inlineMatches && inlineMatches.length >= 2) {
    for (const seg of inlineMatches) {
      const m = seg.match(/\(\d+\)\s*(.+)/);
      if (m) questions.push({ text: m[1].trim().replace(/[,;]$/, '') });
    }
  }

  return questions;
}

export function NeedsInputSection({ data, answers, onChangeAnswer, onSubmit, transitionComment }: {
  data: NeedsInputData | undefined;
  answers: Record<number, string>;
  onChangeAnswer: (idx: number, val: string) => void;
  onSubmit: () => void;
  /** Fallback: the transition comment that may contain questions */
  transitionComment?: string;
}) {
  const questions = data?.pendingQuestions ?? [];
  const parsedQuestions = questions.length > 0 ? questions : parseQuestionsFromComment(transitionComment);

  // If we have structured or parsed questions, show them with individual answer fields
  if (parsedQuestions.length > 0) {
    const answeredCount = parsedQuestions.filter((_, i) => (answers[i] ?? '').trim().length > 0).length;
    const allAnswered = answeredCount === parsedQuestions.length;

    return (
      <Section title="Questions Needing Your Input">
        <p className="text-xs text-gray-500 mb-3">
          Answer the questions below, then submit to send back for re-triage.
          {' '}<span className={answeredCount === 0 ? 'text-gray-600' : 'text-blue-400'}>
            {answeredCount}/{parsedQuestions.length} answered
          </span>
        </p>
        <div className="space-y-3">
          {parsedQuestions.map((q, idx) => {
            const filled = (answers[idx] ?? '').trim().length > 0;
            return (
              <div key={idx} className={`rounded p-3 ${filled ? 'bg-gray-800/30' : 'bg-gray-800/60 border border-gray-700'}`}>
                <p className="text-sm text-gray-300 mb-1.5 font-medium">
                  <span className="text-gray-500 mr-1.5">{idx + 1}.</span>
                  {q.text}
                </p>
                <textarea
                  value={answers[idx] ?? ''}
                  onChange={(e) => onChangeAnswer(idx, e.target.value)}
                  placeholder="Type your answer..."
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-600 focus:border-blue-600 focus:outline-none"
                  rows={2}
                />
              </div>
            );
          })}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={onSubmit}
              disabled={answeredCount === 0}
              title={answeredCount === 0 ? 'Answer at least one question before submitting' : undefined}
              className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Submit &amp; Re-triage
            </button>
            {answeredCount === 0 && (
              <span className="text-[10px] text-amber-400">Answer at least one question</span>
            )}
            {answeredCount > 0 && !allAnswered && (
              <span className="text-[10px] text-gray-500">Unanswered questions will be left blank</span>
            )}
          </div>
        </div>
      </Section>
    );
  }

  // Last resort: show raw comment with a freeform response field
  if (transitionComment) {
    const hasFreeform = (answers[0] ?? '').trim().length > 0;

    return (
      <Section title="Input Requested">
        <p className="text-xs text-gray-500 mb-3">
          The triage agent needs more information. Read the request below and provide your response.
        </p>
        <div className="space-y-3">
          <p className="text-sm text-gray-300 whitespace-pre-wrap bg-gray-800/50 rounded p-3 border border-gray-700">
            {transitionComment}
          </p>
          <textarea
            value={answers[0] ?? ''}
            onChange={(e) => onChangeAnswer(0, e.target.value)}
            placeholder="Type your response..."
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-600 focus:border-blue-600 focus:outline-none"
            rows={4}
          />
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={onSubmit}
              disabled={!hasFreeform}
              title={!hasFreeform ? 'Write a response before submitting' : undefined}
              className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Submit &amp; Re-triage
            </button>
            {!hasFreeform && (
              <span className="text-[10px] text-amber-400">Write a response first</span>
            )}
          </div>
        </div>
      </Section>
    );
  }

  return null;
}

export function FindingsSection({ data }: {
  data: (PlanCritiqueData | IntegrationReviewData) | undefined;
}) {
  const findings = (data as { findings?: Array<{ text: string; severity: string; resolved?: boolean }> })?.findings ?? [];
  if (findings.length === 0) return null;

  return (
    <Section title="Findings">
      <ul className="space-y-2">
        {findings.map((f, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${
              f.severity === 'blocking'
                ? 'bg-red-900/50 text-red-300'
                : 'bg-yellow-900/50 text-yellow-300'
            }`}>
              {f.severity}
            </span>
            <span className={`text-sm ${f.resolved ? 'text-gray-500 line-through' : 'text-gray-300'}`}>
              {f.text}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function FinalReviewSection({ data }: { data: FinalReviewData | undefined }) {
  if (!data) return null;
  return (
    <Section title="PR Links">
      <ul className="space-y-1">
        {(data.prLinks ?? []).map((link, idx) => (
          <li key={idx}>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-400 hover:text-blue-300 underline break-all"
            >
              {link}
            </a>
          </li>
        ))}
      </ul>
      {data.reviewNotes && (
        <p className="text-sm text-gray-400 mt-2 whitespace-pre-wrap">{data.reviewNotes}</p>
      )}
    </Section>
  );
}

export interface ShiftReport {
  generatedAt: string;
  reason: 'escalated' | 'awaiting-merge' | 'done';
  markdown: string;
  stepsUsed: number;
}

export interface AgentProgressEntry {
  agentRole: string;
  summary: string;
  timestamp: string;
}

const SHIFT_REPORT_META: Record<ShiftReport['reason'], { label: string; className: string }> = {
  'awaiting-merge': { label: '✅ Ready for your review — draft PR open', className: 'border-emerald-800/60 bg-emerald-950/30' },
  escalated: { label: '⚠️ Escalated — needs you', className: 'border-amber-800/60 bg-amber-950/30' },
  done: { label: '🏁 Done', className: 'border-gray-800 bg-gray-900' },
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Small "running dark" badge for autonomous epics — used on both list and detail views. */
export function RunningDarkPill() {
  return (
    <span className="text-[10px] px-1.5 py-0.5 bg-fuchsia-900/50 text-fuchsia-300 rounded-full shrink-0">
      🏭 running dark
    </span>
  );
}

/** Paused badge — shown when an autonomous epic is paused for usage pacing. */
export function PausedPill({ until, reason }: { until?: string; reason?: string }) {
  const resumeHint = until
    ? ` · resumes ${new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : '';
  const title = [
    reason || 'Paused for usage pacing',
    until ? `Resumes around ${new Date(until).toLocaleString()}` : null,
  ].filter(Boolean).join(' — ');
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 bg-amber-900/50 text-amber-300 rounded-full shrink-0"
      title={title}
    >
      ⏸ paused{resumeHint}
    </span>
  );
}

export function ShiftReportSection({ report }: { report: ShiftReport | undefined }) {
  if (!report) return null;
  const meta = SHIFT_REPORT_META[report.reason] ?? SHIFT_REPORT_META.done;

  return (
    <div className={`border rounded-lg p-4 ${meta.className}`}>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <h3 className="text-sm font-semibold text-gray-100">{meta.label}</h3>
        <span className="text-[10px] text-gray-500 ml-auto">
          {report.stepsUsed} step{report.stepsUsed === 1 ? '' : 's'} &middot; {formatRelativeTime(report.generatedAt)}
        </span>
      </div>
      <div className="text-sm text-gray-300 markdown-body">
        <Markdown>{report.markdown}</Markdown>
      </div>
    </div>
  );
}

export function ProgressFeedSection({ entries }: { entries: AgentProgressEntry[] | undefined }) {
  if (!entries || entries.length === 0) return null;
  const sorted = [...entries].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return (
    <Section title="Progress">
      <ul className="space-y-1.5">
        {sorted.map((e, idx) => (
          <li key={idx} className="flex items-start gap-2 text-xs">
            <span className="text-gray-600 shrink-0">{formatRelativeTime(e.timestamp)}</span>
            <span className="text-gray-300">
              <span className="text-gray-500">{e.agentRole}:</span> {e.summary}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function MiniTaskBoard({ tasks, sessions, onClickTask, onAttachSession }: {
  tasks: WorkflowTicket[];
  sessions?: Session[];
  onClickTask: (t: WorkflowTicket) => void;
  onAttachSession?: (session: Session) => void;
}) {
  // Derive columns dynamically from actual task states
  const columns = useMemo(() => {
    const stateSet = new Set(tasks.map((t) => t.state));
    return [...stateSet].sort((a, b) => {
      const oa = STATE_ORDER[a] ?? 50;
      const ob = STATE_ORDER[b] ?? 50;
      return oa - ob;
    });
  }, [tasks]);

  // Build session lookup: sessionId → Session (active only)
  const sessionMap = useMemo(() => {
    const map = new Map<string, Session>();
    if (sessions) {
      for (const s of sessions) {
        if (s.state === 'active') map.set(s.id, s);
      }
    }
    return map;
  }, [sessions]);

  /** Find the first live session for a task */
  function findLiveSession(task: WorkflowTicket): Session | undefined {
    const sd = task.stateData as Record<string, unknown> | undefined;
    const ids = (sd?.agentSessionIds as string[] | undefined) ?? [];
    for (const sid of ids) {
      const s = sessionMap.get(sid);
      if (s) return s;
    }
    return undefined;
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => {
        const colTasks = tasks.filter((t) => t.state === col);
        return (
          <div key={col} className="min-w-[150px] flex-1">
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              {col.replace(/-/g, ' ')} ({colTasks.length})
            </div>
            <div className="space-y-1.5">
              {colTasks.map((task) => {
                const liveSession = findLiveSession(task);
                return (
                  <div
                    key={task.id}
                    className={`p-2 bg-gray-800 border rounded transition-colors ${
                      liveSession ? 'border-blue-800/60' : 'border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    <button
                      onClick={() => onClickTask(task)}
                      className="w-full text-left"
                    >
                      <p className="text-xs text-gray-200 truncate">{task.title}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <WorkflowStateIndicator state={task.state} ticketType="task" size="sm" />
                        {liveSession && (
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" title="Agent running" />
                        )}
                      </div>
                    </button>
                    {liveSession && onAttachSession && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onAttachSession(liveSession); }}
                        className="mt-1.5 w-full text-[10px] px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                      >
                        Attach to session
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
