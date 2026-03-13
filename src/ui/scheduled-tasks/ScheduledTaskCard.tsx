import { useState } from 'react';
import type { ScheduledTask, ScheduledTaskRun } from '@foundation/types';

interface Props {
  task: ScheduledTask;
  trackName?: string;
  agentName?: string;
  onToggle: () => void;
  onTrigger: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  running: 'bg-amber-900/60 text-amber-300',
  completed: 'bg-green-900/60 text-green-300',
  failed: 'bg-red-900/60 text-red-300',
};

export function ScheduledTaskCard({
  task,
  trackName,
  agentName,
  onToggle,
  onTrigger,
  onEdit,
  onDelete,
}: Props) {
  const [showRuns, setShowRuns] = useState(false);
  const [runs, setRuns] = useState<ScheduledTaskRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function loadRuns() {
    if (showRuns) {
      setShowRuns(false);
      return;
    }
    setRunsLoading(true);
    try {
      const res = await fetch(`/api/scheduled-tasks/${task.id}/runs?limit=10`);
      if (res.ok) setRuns(await res.json());
    } catch {
      // ignore
    } finally {
      setRunsLoading(false);
      setShowRuns(true);
    }
  }

  return (
    <div
      className={`border rounded-lg transition-colors ${
        task.enabled
          ? 'bg-gray-900 border-gray-800 hover:border-gray-700'
          : 'bg-gray-900/50 border-gray-800/50 opacity-60'
      }`}
    >
      <div className="px-4 py-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <button
                onClick={onToggle}
                className={`w-8 h-4 rounded-full relative transition-colors shrink-0 ${
                  task.enabled ? 'bg-green-600' : 'bg-gray-700'
                }`}
                title={task.enabled ? 'Disable' : 'Enable'}
              >
                <span
                  className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                    task.enabled ? 'left-4' : 'left-0.5'
                  }`}
                />
              </button>
              <h3 className="text-sm font-medium text-gray-200 truncate">{task.name}</h3>
            </div>

            {task.description && (
              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.description}</p>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={onTrigger}
              className="text-[10px] px-2 py-1 bg-blue-900/50 text-blue-300 rounded hover:bg-blue-800/50 transition-colors"
              title="Run now"
            >
              Run Now
            </button>
            <button
              onClick={onEdit}
              className="text-[10px] px-2 py-1 text-gray-400 hover:text-gray-200 transition-colors"
            >
              Edit
            </button>
            {confirmDelete ? (
              <span className="flex items-center gap-1">
                <button
                  onClick={onDelete}
                  className="text-[10px] px-2 py-1 text-red-400 hover:text-red-300"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-[10px] px-2 py-1 text-gray-500 hover:text-gray-300"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-[10px] px-2 py-1 text-gray-600 hover:text-red-400 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Info row */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {/* Schedule badge */}
          <span className="text-[10px] px-1.5 py-0.5 bg-indigo-900/50 text-indigo-300 rounded font-mono">
            {task.scheduleDescription || task.cronExpression}
          </span>

          {/* Provider badge */}
          <span className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded">
            {task.provider}
          </span>

          {/* Track badge */}
          {trackName && (
            <span className="text-[10px] px-1.5 py-0.5 bg-cyan-900/50 text-cyan-300 rounded">
              {trackName}
            </span>
          )}

          {/* Agent badge */}
          {agentName && (
            <span className="text-[10px] px-1.5 py-0.5 bg-purple-900/50 text-purple-300 rounded">
              {agentName}
            </span>
          )}

          {/* Last run status */}
          {task.lastRunStatus && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLES[task.lastRunStatus] || ''}`}
            >
              {task.lastRunStatus}
            </span>
          )}

          {/* Run count */}
          {task.runCount > 0 && (
            <span className="text-[10px] text-gray-600">
              {task.runCount} run{task.runCount !== 1 ? 's' : ''}
            </span>
          )}

          {/* Last run time */}
          {task.lastRunAt && (
            <span className="text-[10px] text-gray-600" title={task.lastRunAt}>
              last: {formatRelativeTime(task.lastRunAt)}
            </span>
          )}
        </div>

        {/* Task prompt preview */}
        <div className="mt-2 text-xs text-gray-500 font-mono bg-gray-950/50 rounded px-2 py-1 line-clamp-2">
          {task.taskPrompt}
        </div>

        {/* Run history toggle */}
        <button
          onClick={loadRuns}
          className="mt-2 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
        >
          {showRuns ? 'Hide history' : 'Show history'}
        </button>

        {/* Run history */}
        {showRuns && (
          <div className="mt-2 space-y-1">
            {runsLoading ? (
              <span className="text-[10px] text-gray-600">Loading...</span>
            ) : runs.length === 0 ? (
              <span className="text-[10px] text-gray-600 italic">No runs yet.</span>
            ) : (
              runs.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center gap-2 text-[10px] px-2 py-1 bg-gray-950/50 rounded"
                >
                  <span className={`px-1 py-0.5 rounded ${STATUS_STYLES[run.status] || ''}`}>
                    {run.status}
                  </span>
                  <span className="text-gray-500">{formatRelativeTime(run.startedAt)}</span>
                  {run.error && <span className="text-red-400 truncate">{run.error}</span>}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

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
