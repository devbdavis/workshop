import type {
  WorkflowTicket, NeedsInputData, PlanCritiqueData,
  IntegrationReviewData, FinalReviewData,
} from '@foundation/types';
import { WorkflowStateIndicator } from './WorkflowStateIndicator';

const TASK_COLUMNS = ['blocked', 'ready', 'in-progress', 'code-review', 'done'] as const;

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
    return (
      <Section title="Questions Needing Your Input">
        <div className="space-y-3">
          {parsedQuestions.map((q, idx) => (
            <div key={idx}>
              <p className="text-sm text-gray-300 mb-1">{q.text}</p>
              <textarea
                value={answers[idx] ?? ''}
                onChange={(e) => onChangeAnswer(idx, e.target.value)}
                placeholder="Your answer..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200"
                rows={2}
              />
            </div>
          ))}
          <button
            onClick={onSubmit}
            className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
          >
            Submit Answers
          </button>
        </div>
      </Section>
    );
  }

  // Last resort: show raw comment with a freeform response field
  if (transitionComment) {
    return (
      <Section title="Input Requested">
        <div className="space-y-3">
          <p className="text-sm text-gray-300 whitespace-pre-wrap bg-gray-800/50 rounded p-3 border border-gray-700">
            {transitionComment}
          </p>
          <textarea
            value={answers[0] ?? ''}
            onChange={(e) => onChangeAnswer(0, e.target.value)}
            placeholder="Your response..."
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200"
            rows={4}
          />
          <button
            onClick={onSubmit}
            className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
          >
            Submit Response
          </button>
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

export function MiniTaskBoard({ tasks, onClickTask }: {
  tasks: WorkflowTicket[];
  onClickTask: (t: WorkflowTicket) => void;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {TASK_COLUMNS.map((col) => {
        const colTasks = tasks.filter((t) => t.state === col);
        return (
          <div key={col} className="min-w-[140px] flex-1">
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
              {col.replace(/-/g, ' ')} ({colTasks.length})
            </div>
            <div className="space-y-1.5">
              {colTasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => onClickTask(task)}
                  className="w-full text-left p-2 bg-gray-800 border border-gray-700 rounded hover:border-gray-600 transition-colors"
                >
                  <p className="text-xs text-gray-200 truncate">{task.title}</p>
                  <WorkflowStateIndicator state={task.state} ticketType="task" size="sm" />
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
