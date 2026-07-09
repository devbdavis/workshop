import { getDatabase } from './database.js';
import type {
  PrMonitorRepository,
  PrMonitorRegistration,
  PrMonitorPollUpdate,
} from '@domain/pr-monitor/repository';
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

interface PrMonitorRow {
  pr_url: string;
  todo_id: string;
  track_id: string;
  repo_owner: string;
  repo_name: string;
  pr_number: number;
  pr_title: string | null;
  pr_branch: string | null;
  head_ref_oid: string | null;
  state: string;
  check_status: string;
  failing_checks: string | null;
  unresolved_comments: string | null;
  needs_attention_since: string | null;
  last_polled_at: string | null;
  last_event_at: string | null;
  last_push_at: string | null;
  monitoring: number;
  pause_reason: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_STATES: ReadonlySet<PrState> = new Set(['open', 'draft', 'merged', 'closed', 'unknown']);
const VALID_CHECK_STATUSES: ReadonlySet<PrCheckStatus> = new Set(['none', 'pending', 'passing', 'failing', 'error']);
const VALID_PAUSE_REASONS: ReadonlySet<PrPauseReason> = new Set(['finished', 'stale', 'user']);

function parseState(raw: string): PrState {
  return VALID_STATES.has(raw as PrState) ? (raw as PrState) : 'unknown';
}

function parseCheckStatus(raw: string): PrCheckStatus {
  return VALID_CHECK_STATUSES.has(raw as PrCheckStatus) ? (raw as PrCheckStatus) : 'none';
}

function parsePauseReason(raw: string | null): PrPauseReason | undefined {
  if (raw === null) return undefined;
  return VALID_PAUSE_REASONS.has(raw as PrPauseReason) ? (raw as PrPauseReason) : undefined;
}

function parseJsonArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function rowToMonitor(row: PrMonitorRow): PrMonitor {
  return {
    prUrl: row.pr_url,
    todoId: row.todo_id as TodoId,
    trackId: row.track_id as TrackId,
    repoOwner: row.repo_owner,
    repoName: row.repo_name,
    prNumber: row.pr_number,
    prTitle: row.pr_title ?? undefined,
    prBranch: row.pr_branch ?? undefined,
    headRefOid: row.head_ref_oid ?? undefined,
    state: parseState(row.state),
    checkStatus: parseCheckStatus(row.check_status),
    failingChecks: parseJsonArray<PrCheckSummary>(row.failing_checks),
    unresolvedComments: parseJsonArray<PrComment>(row.unresolved_comments),
    needsAttentionSince: row.needs_attention_since ?? undefined,
    lastPolledAt: row.last_polled_at ?? undefined,
    lastEventAt: row.last_event_at ?? undefined,
    lastPushAt: row.last_push_at ?? undefined,
    monitoring: row.monitoring === 1,
    pauseReason: parsePauseReason(row.pause_reason),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function deriveNeedsAttentionSince(
  existing: PrMonitor | null,
  next: { state: PrState; checkStatus: PrCheckStatus; unresolvedComments: PrComment[] },
  now: string,
): string | null {
  const needsAttentionNow =
    (next.state === 'open' || next.state === 'draft') &&
    (next.checkStatus === 'failing' || next.checkStatus === 'error' || next.unresolvedComments.length > 0);
  if (!needsAttentionNow) return null;
  if (existing?.needsAttentionSince) return existing.needsAttentionSince;
  return now;
}

export function createPrMonitorRepository(): PrMonitorRepository {
  const db = getDatabase();

  const findByUrlStmt = db.prepare('SELECT * FROM pr_monitors WHERE pr_url = ?');
  const findByTodoStmt = db.prepare('SELECT * FROM pr_monitors WHERE todo_id = ? ORDER BY created_at ASC');
  const findByTrackStmt = db.prepare('SELECT * FROM pr_monitors WHERE track_id = ? ORDER BY created_at ASC');
  // Polling order: never-polled first (last_polled_at IS NULL), then oldest poll.
  const findDueStmt = db.prepare(`
    SELECT * FROM pr_monitors
    WHERE monitoring = 1
      AND (last_polled_at IS NULL OR last_polled_at <= ?)
    ORDER BY last_polled_at IS NULL DESC, last_polled_at ASC
    LIMIT ?
  `);
  const insertStmt = db.prepare(`
    INSERT INTO pr_monitors (
      pr_url, todo_id, track_id, repo_owner, repo_name, pr_number, pr_title, pr_branch,
      state, check_status, failing_checks, unresolved_comments,
      needs_attention_since, last_polled_at, last_event_at, last_push_at, monitoring, pause_reason,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'unknown', 'none', NULL, NULL, NULL, NULL, NULL, NULL, 1, NULL, ?, ?)
  `);
  const updateRegistrationStmt = db.prepare(`
    UPDATE pr_monitors
    SET todo_id = ?, track_id = ?, repo_owner = ?, repo_name = ?, pr_number = ?,
        pr_title = COALESCE(?, pr_title), monitoring = 1, pause_reason = NULL, updated_at = ?
    WHERE pr_url = ?
  `);
  const applyPollStmt = db.prepare(`
    UPDATE pr_monitors
    SET state = ?, check_status = ?, failing_checks = ?, unresolved_comments = ?,
        pr_title = COALESCE(?, pr_title),
        pr_branch = COALESCE(?, pr_branch),
        head_ref_oid = COALESCE(?, head_ref_oid),
        needs_attention_since = ?,
        last_polled_at = ?,
        last_event_at = COALESCE(?, last_event_at),
        last_push_at = COALESCE(?, last_push_at),
        monitoring = ?,
        pause_reason = ?,
        updated_at = ?
    WHERE pr_url = ?
  `);
  const pauseStmt = db.prepare('UPDATE pr_monitors SET monitoring = 0, pause_reason = ?, updated_at = ? WHERE pr_url = ?');
  const resumeStmt = db.prepare(`
    UPDATE pr_monitors
    SET monitoring = 1, pause_reason = NULL,
        last_push_at = ?, last_polled_at = NULL, updated_at = ?
    WHERE pr_url = ?
  `);
  const deleteStmt = db.prepare('DELETE FROM pr_monitors WHERE pr_url = ?');
  const getDismissedStmt = db.prepare('SELECT dismissed_comment_ids FROM pr_monitors WHERE pr_url = ?');
  const dismissCommentsStmt = db.prepare(`
    UPDATE pr_monitors
    SET dismissed_comment_ids = ?, unresolved_comments = ?, needs_attention_since = ?, updated_at = ?
    WHERE pr_url = ?
  `);

  function readDismissedIds(prUrl: string): Set<string> {
    const row = getDismissedStmt.get(prUrl) as { dismissed_comment_ids: string | null } | undefined;
    return new Set(parseJsonArray<string>(row?.dismissed_comment_ids ?? null));
  }

  return {
    findByUrl(prUrl: string): PrMonitor | null {
      const row = findByUrlStmt.get(prUrl) as PrMonitorRow | undefined;
      return row ? rowToMonitor(row) : null;
    },

    findByTodo(todoId: TodoId): PrMonitor[] {
      const rows = findByTodoStmt.all(todoId) as PrMonitorRow[];
      return rows.map(rowToMonitor);
    },

    findByTrack(trackId: TrackId): PrMonitor[] {
      const rows = findByTrackStmt.all(trackId) as PrMonitorRow[];
      return rows.map(rowToMonitor);
    },

    findDueForPolling(limit: number, olderThanIso: string): PrMonitor[] {
      const rows = findDueStmt.all(olderThanIso, limit) as PrMonitorRow[];
      return rows.map(rowToMonitor);
    },

    register(reg: PrMonitorRegistration): PrMonitor {
      const now = new Date().toISOString();
      const existing = this.findByUrl(reg.prUrl);
      if (existing) {
        updateRegistrationStmt.run(
          reg.todoId,
          reg.trackId,
          reg.repoOwner,
          reg.repoName,
          reg.prNumber,
          reg.prTitle ?? null,
          now,
          reg.prUrl,
        );
        return this.findByUrl(reg.prUrl)!;
      }
      insertStmt.run(
        reg.prUrl,
        reg.todoId,
        reg.trackId,
        reg.repoOwner,
        reg.repoName,
        reg.prNumber,
        reg.prTitle ?? null,
        now,
        now,
      );
      return this.findByUrl(reg.prUrl)!;
    },

    unregister(prUrl: string): boolean {
      const result = deleteStmt.run(prUrl);
      return result.changes > 0;
    },

    pauseMonitoring(prUrl: string, reason: PrPauseReason): PrMonitor | null {
      const now = new Date().toISOString();
      pauseStmt.run(reason, now, prUrl);
      return this.findByUrl(prUrl);
    },

    resumeMonitoring(prUrl: string): PrMonitor | null {
      const now = new Date().toISOString();
      // last_polled_at=NULL bumps the row to the front of the polling queue so
      // the caller can trust the next tick (or an immediate pollNow) will refresh it.
      resumeStmt.run(now, now, prUrl);
      return this.findByUrl(prUrl);
    },

    applyPoll(prUrl: string, update: PrMonitorPollUpdate): PrMonitor | null {
      const existing = this.findByUrl(prUrl);
      if (!existing) return null;
      const now = new Date().toISOString();
      const eventTimestamp = update.changed ? now : null;

      // Drop dismissed comments before persisting or computing attention — the
      // poller's `unresolvedComments` is a fresh, wholesale `gh` fetch that
      // knows nothing about dismissals, so we re-apply them on every poll.
      const dismissedIds = readDismissedIds(prUrl);
      const filteredComments = update.unresolvedComments.filter((c) => !dismissedIds.has(c.id));
      const needsAttentionSince = deriveNeedsAttentionSince(
        existing,
        { state: update.state, checkStatus: update.checkStatus, unresolvedComments: filteredComments },
        now,
      );

      // Push detection: if a new oid appeared, bump last_push_at.
      // First-ever poll (existing.headRefOid missing) also seeds last_push_at.
      const nextOid = update.headRefOid;
      const seededPushTimestamp =
        nextOid && (!existing.headRefOid || existing.headRefOid !== nextOid) ? now : null;

      // Merge/close always wins; otherwise let existing monitoring/pauseReason ride.
      // The poller decides stale-pause itself and sends stopMonitoring=true with reason.
      const monitoring = update.stopMonitoring ? 0 : (existing.monitoring ? 1 : 0);
      const pauseReason = update.stopMonitoring
        ? (update.state === 'merged' || update.state === 'closed' ? 'finished' : (existing.pauseReason ?? 'stale'))
        : (existing.pauseReason ?? null);

      applyPollStmt.run(
        update.state,
        update.checkStatus,
        update.failingChecks.length > 0 ? JSON.stringify(update.failingChecks) : null,
        filteredComments.length > 0 ? JSON.stringify(filteredComments) : null,
        update.prTitle ?? null,
        update.prBranch ?? null,
        nextOid ?? null,
        needsAttentionSince,
        now,
        eventTimestamp,
        seededPushTimestamp,
        monitoring,
        pauseReason,
        now,
        prUrl,
      );
      return this.findByUrl(prUrl);
    },

    getDismissedCommentIds(prUrl: string): string[] {
      return [...readDismissedIds(prUrl)];
    },

    dismissComments(prUrl: string, commentIds: string[]): PrMonitor | null {
      const existing = this.findByUrl(prUrl);
      if (!existing) return null;
      const now = new Date().toISOString();

      const dismissed = readDismissedIds(prUrl);
      for (const id of commentIds) dismissed.add(id);
      const remainingComments = existing.unresolvedComments.filter((c) => !dismissed.has(c.id));
      const needsAttentionSince = deriveNeedsAttentionSince(
        existing,
        { state: existing.state, checkStatus: existing.checkStatus, unresolvedComments: remainingComments },
        now,
      );

      dismissCommentsStmt.run(
        JSON.stringify([...dismissed]),
        remainingComments.length > 0 ? JSON.stringify(remainingComments) : null,
        needsAttentionSince,
        now,
        prUrl,
      );
      return this.findByUrl(prUrl);
    },
  };
}
