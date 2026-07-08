import type {
  PrMonitor,
  PrState,
  PrCheckStatus,
  PrCheckSummary,
  PrComment,
  PrPauseReason,
  TodoId,
  TrackId,
} from '@foundation/types';

/** Fields the poller is allowed to write back when it finishes a poll. */
export interface PrMonitorPollUpdate {
  state: PrState;
  checkStatus: PrCheckStatus;
  failingChecks: PrCheckSummary[];
  unresolvedComments: PrComment[];
  prTitle?: string;
  prBranch?: string;
  /** Head SHA seen this poll. When it differs from the stored oid, the repo
   *  bumps `lastPushAt`. Missing/undefined leaves prior push-tracking alone. */
  headRefOid?: string;
  /** Set to true when a change was observed; the repo stamps `lastEventAt`. */
  changed: boolean;
  /** When true (PR merged or closed) the repo flips `monitoring` off with reason=`finished`. */
  stopMonitoring: boolean;
}

/** Shape used to register a new PR (or re-register an existing one for a different todo). */
export interface PrMonitorRegistration {
  prUrl: string;
  todoId: TodoId;
  trackId: TrackId;
  repoOwner: string;
  repoName: string;
  prNumber: number;
  prTitle?: string;
}

export interface PrMonitorRepository {
  findByUrl(prUrl: string): PrMonitor | null;
  findByTodo(todoId: TodoId): PrMonitor[];
  findByTrack(trackId: TrackId): PrMonitor[];
  /** Used by the poller to pick the next batch of PRs that need a refresh. */
  findDueForPolling(limit: number, olderThanIso: string): PrMonitor[];
  /** Idempotent registration — upserts by `prUrl`. Preserves poll history when re-registering. */
  register(reg: PrMonitorRegistration): PrMonitor;
  /** Permanently deletes a monitor row. */
  unregister(prUrl: string): boolean;
  /** Stops polling without losing history. Records the given reason. */
  pauseMonitoring(prUrl: string, reason: PrPauseReason): PrMonitor | null;
  /** Re-enables polling, clears `pauseReason`, and resets `lastPushAt` to now so
   *  the stale-cutoff window restarts. Returns the fresh row (or null if unknown). */
  resumeMonitoring(prUrl: string): PrMonitor | null;
  /** Records the result of a poll attempt and bumps `lastPolledAt`. */
  applyPoll(prUrl: string, update: PrMonitorPollUpdate): PrMonitor | null;
  /** Marks comments as dismissed (persisted so they don't reappear on the next poll)
   *  and immediately strips them from `unresolvedComments`. Returns null if unknown. */
  dismissComments(prUrl: string, commentIds: string[]): PrMonitor | null;
  /** The set of comment IDs previously dismissed for this PR. Empty if unknown/none.
   *  The poller uses this to filter the raw `gh` snapshot before deciding whether
   *  anything changed, so a dismissed-but-still-open GitHub comment doesn't keep the
   *  monitor perpetually "changed". */
  getDismissedCommentIds(prUrl: string): string[];
}
