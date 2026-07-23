import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Todo, TodoPriority } from '@foundation/types';
import { isGithubIssueKey } from '@foundation/issue-tracker.js';

interface Props {
  todo: Todo;
  trackName?: string;
  onClick: (todo: Todo) => void;
}

const PRIORITY_STYLES: Record<TodoPriority, { border: string; badge: string; label: string }> = {
  high: { border: 'border-l-red-500', badge: 'bg-red-900/50 text-red-300', label: 'High' },
  medium: { border: 'border-l-yellow-500', badge: 'bg-yellow-900/50 text-yellow-300', label: 'Med' },
  low: { border: 'border-l-gray-600', badge: 'bg-gray-800 text-gray-400', label: 'Low' },
};

/**
 * Small Linear mark — half-shaded circle.  Mirrors the icon used in the
 * session pane header (SessionLinkButtons.tsx) but inlined here so the card
 * stays self-contained.
 */
function LinearMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.5 A6.5 6.5 0 0 1 8 14.5 Z" fill="currentColor" fillOpacity="0.35" />
      <path d="M8 1.5 A6.5 6.5 0 0 0 8 14.5 Z" fill="currentColor" fillOpacity="0.85" />
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1" />
    </svg>
  );
}

/** GitHub mark — mirrors the icon used in the session pane header (SessionLinkButtons.tsx). */
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z" />
    </svg>
  );
}

export function KanbanCard({ todo, trackName, onClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: todo.id,
    data: { type: 'todo', todo },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const ps = PRIORITY_STYLES[todo.priority];

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(todo)}
      className={`p-3 bg-gray-900 border border-gray-800 border-l-2 ${ps.border} rounded-lg cursor-grab active:cursor-grabbing hover:border-gray-600 transition-colors`}
    >
      <p className="text-sm text-gray-200 font-medium leading-snug mb-2">{todo.title}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        {trackName && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 truncate max-w-[120px]">
            {trackName}
          </span>
        )}
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${ps.badge}`}>{ps.label}</span>
        {todo.issueKey && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/50 text-indigo-300 flex items-center gap-1 font-mono"
            title={
              isGithubIssueKey(todo.issueKey)
                ? `Linked to GitHub issue ${todo.issueKey}`
                : `Linked to Linear ticket ${todo.issueKey}`
            }
          >
            {isGithubIssueKey(todo.issueKey) ? (
              <GitHubMark className="w-3 h-3" />
            ) : (
              <LinearMark className="w-3 h-3" />
            )}
            {todo.issueKey}
          </span>
        )}
        {todo.sessionId && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Agent
          </span>
        )}
      </div>
    </div>
  );
}
