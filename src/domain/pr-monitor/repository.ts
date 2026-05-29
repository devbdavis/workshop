import type {
  PrMonitor,
  PrState,
  PrCheckStatus,
  PrCheckSummary,
  PrComment,
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
  /** Set to true when a change was observed; the repo stamps `lastEventAt`. */
  changed: boolean;
  /** When true (PR merged or closed) the repo flips `monitoring` off. */
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
  /** Idempotent registration — upserts by `prUrl`. */
  register(reg: PrMonitorRegistration): PrMonitor;
  /** Permanently deletes a monitor row. */
  unregister(prUrl: string): boolean;
  /** Stops polling without losing history. */
  pauseMonitoring(prUrl: string): PrMonitor | null;
  /** Records the result of a poll attempt and bumps `lastPolledAt`. */
  applyPoll(prUrl: string, update: PrMonitorPollUpdate): PrMonitor | null;
}
