import type { WorkflowTicket, Track } from '@foundation/types.js';
import { WorkflowStateIndicator } from './WorkflowStateIndicator.js';
import { RunningDarkPill } from './EpicDetailSections.js';

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-900/50 text-red-300',
  high: 'bg-red-900/40 text-red-400',
  medium: 'bg-yellow-900/50 text-yellow-300',
  low: 'bg-gray-800 text-gray-400',
};

type FilterTab = 'all' | 'active' | 'review' | 'done';

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'review', label: 'Human Review' },
  { value: 'done', label: 'Done' },
];

// Legacy state sets — kept for backward compatibility with tickets without templates
const LEGACY_TERMINAL_STATES = new Set(['merged', 'cancelled', 'done']);
const LEGACY_HUMAN_REVIEW_STATES = new Set(['spec-review', 'plan-review', 'final-review', 'code-review', 'needs-input']);
const LEGACY_DONE_STATES = new Set(['merged', 'approved', 'done']);

/** Check if ticket is in a terminal state (dynamic template or legacy fallback) */
function isTerminalState(ticket: WorkflowTicket): boolean {
  const sd = ticket.stateData as Record<string, unknown> | undefined;
  if (sd?.currentStateSemanticRole === 'terminal') return true;
  return LEGACY_TERMINAL_STATES.has(ticket.state);
}

/** Check if ticket is at a human gate requiring review (dynamic template or legacy fallback) */
function isHumanReviewState(ticket: WorkflowTicket): boolean {
  const sd = ticket.stateData as Record<string, unknown> | undefined;
  if (sd?.currentStateHumanGate === true) return true;
  return LEGACY_HUMAN_REVIEW_STATES.has(ticket.state);
}

/** Check if ticket is in a done state (successful terminal) */
function isDoneState(ticket: WorkflowTicket): boolean {
  const sd = ticket.stateData as Record<string, unknown> | undefined;
  if (sd?.currentStateSemanticRole === 'terminal' && ticket.state !== 'cancelled') return true;
  return LEGACY_DONE_STATES.has(ticket.state);
}

interface EpicListProps {
  epics: WorkflowTicket[];
  tracks: Track[];
  allTasks?: WorkflowTicket[];
  filter: FilterTab;
  onFilterChange: (filter: FilterTab) => void;
  onEpicClick: (epicId: string) => void;
  onCreateClick: () => void;
}

export function EpicList({
  epics,
  tracks,
  allTasks,
  filter,
  onFilterChange,
  onEpicClick,
  onCreateClick,
}: EpicListProps) {
  const trackNames = Object.fromEntries(tracks.map((t) => [t.id, t.name]));

  // Build a set of epic IDs that have children at human gates
  const epicsWithChildReview = new Set<string>();
  if (allTasks) {
    for (const task of allTasks) {
      if (task.parentId && isHumanReviewState(task)) {
        epicsWithChildReview.add(task.parentId);
      }
    }
  }

  const filtered = epics.filter((e) => {
    if (filter === 'active') return !isTerminalState(e);
    if (filter === 'review') return isHumanReviewState(e) || epicsWithChildReview.has(e.id);
    if (filter === 'done') return isDoneState(e);
    return true;
  });

  return (
    <>
      <header className="flex items-center gap-4 px-6 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs text-gray-500">{filtered.length} epics</span>
        <div className="ml-auto flex items-center gap-2">
          {FILTER_TABS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onFilterChange(value)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                filter === value
                  ? 'bg-gray-800 text-gray-200'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={onCreateClick}
            className="ml-2 px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
          >
            + New Epic
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            {epics.length === 0
              ? 'No workflow epics yet. Create one to get started.'
              : 'No epics match the current filter.'}
          </div>
        ) : (
          <div className="grid gap-4 max-w-4xl">
            {filtered.map((epic) => {
              const childReviewCount = allTasks
                ? allTasks.filter((t) => t.parentId === epic.id && isHumanReviewState(t)).length
                : 0;
              return (
                <EpicCard
                  key={epic.id}
                  epic={epic}
                  trackName={epic.trackId ? trackNames[epic.trackId] : undefined}
                  childReviewCount={childReviewCount}
                  onClick={() => onEpicClick(epic.id)}
                />
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function EpicCard({
  epic,
  trackName,
  childReviewCount,
  onClick,
}: {
  epic: WorkflowTicket;
  trackName?: string;
  childReviewCount?: number;
  onClick: () => void;
}) {
  const stateData = epic.stateData as Record<string, unknown> | undefined;
  const totalTasks = (stateData?.totalTasks as number) ?? 0;
  const completedTasks = (stateData?.completedTasks as number) ?? 0;
  const showProgress = totalTasks > 0;

  return (
    <div
      onClick={onClick}
      className="border border-gray-800 bg-gray-900 rounded-lg px-4 py-3 hover:border-gray-700 cursor-pointer transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-medium text-gray-200 truncate">{epic.title}</h3>
            <WorkflowStateIndicator state={epic.state} ticketType="epic" stateData={epic.stateData as Record<string, unknown> | undefined} />
            {stateData?.autonomous === true && <RunningDarkPill />}
            {childReviewCount != null && childReviewCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 bg-amber-900/60 text-amber-300 rounded-full animate-pulse">
                {childReviewCount} task{childReviewCount > 1 ? 's' : ''} awaiting review
              </span>
            )}
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${PRIORITY_STYLES[epic.priority]}`}>
              {epic.priority}
            </span>
          </div>
          {epic.description && (
            <p className="text-xs text-gray-500 line-clamp-2">{epic.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {trackName && (
          <span className="text-[10px] px-1.5 py-0.5 bg-cyan-900/50 text-cyan-300 rounded">
            {trackName}
          </span>
        )}
        <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">
          {epic.provider}
        </span>
        {showProgress && (
          <div className="flex items-center gap-1.5 ml-auto">
            <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-600 rounded-full transition-all"
                style={{ width: `${totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0}%` }}
              />
            </div>
            <span className="text-[10px] text-gray-500">
              {completedTasks}/{totalTasks} tasks
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export type { FilterTab };
