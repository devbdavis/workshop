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
  state: string;
  check_status: string;
  failing_checks: string | null;
  unresolved_comments: string | null;
  needs_attention_since: string | null;
  last_polled_at: string | null;
  last_event_at: string | null;
  monitoring: number;
  created_at: string;
  updated_at: string;
}

const VALID_STATES: ReadonlySet<PrState> = new Set(['open', 'draft', 'merged', 'closed', 'unknown']);
const VALID_CHECK_STATUSES: ReadonlySet<PrCheckStatus> = new Set(['none', 'pending', 'passing', 'failing', 'error']);

function parseState(raw: string): PrState {
  return VALID_STATES.has(raw as PrState) ? (raw as PrState) : 'unknown';
}

function parseCheckStatus(raw: string): PrCheckStatus {
  return VALID_CHECK_STATUSES.has(raw as PrCheckStatus) ? (raw as PrCheckStatus) : 'none';
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
    state: parseState(row.state),
    checkStatus: parseCheckStatus(row.check_status),
    failingChecks: parseJsonArray<PrCheckSummary>(row.failing_checks),
    unresolvedComments: parseJsonArray<PrComment>(row.unresolved_comments),
    needsAttentionSince: row.needs_attention_since ?? undefined,
    lastPolledAt: row.last_polled_at ?? undefined,
    lastEventAt: row.last_event_at ?? undefined,
    monitoring: row.monitoring === 1,
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
      needs_attention_since, last_polled_at, last_event_at, monitoring,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'unknown', 'none', NULL, NULL, NULL, NULL, NULL, 1, ?, ?)
  `);
  const updateRegistrationStmt = db.prepare(`
    UPDATE pr_monitors
    SET todo_id = ?, track_id = ?, repo_owner = ?, repo_name = ?, pr_number = ?,
        pr_title = COALESCE(?, pr_title), monitoring = 1, updated_at = ?
    WHERE pr_url = ?
  `);
  const applyPollStmt = db.prepare(`
    UPDATE pr_monitors
    SET state = ?, check_status = ?, failing_checks = ?, unresolved_comments = ?,
        pr_title = COALESCE(?, pr_title),
        pr_branch = COALESCE(?, pr_branch),
        needs_attention_since = ?,
        last_polled_at = ?,
        last_event_at = COALESCE(?, last_event_at),
        monitoring = ?,
        updated_at = ?
    WHERE pr_url = ?
  `);
  const pauseStmt = db.prepare('UPDATE pr_monitors SET monitoring = 0, updated_at = ? WHERE pr_url = ?');
  const deleteStmt = db.prepare('DELETE FROM pr_monitors WHERE pr_url = ?');

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

    pauseMonitoring(prUrl: string): PrMonitor | null {
      const now = new Date().toISOString();
      pauseStmt.run(now, prUrl);
      return this.findByUrl(prUrl);
    },

    applyPoll(prUrl: string, update: PrMonitorPollUpdate): PrMonitor | null {
      const existing = this.findByUrl(prUrl);
      if (!existing) return null;
      const now = new Date().toISOString();
      const eventTimestamp = update.changed ? now : null;
      const needsAttentionSince = deriveNeedsAttentionSince(existing, update, now);
      const monitoring = update.stopMonitoring ? 0 : (existing.monitoring ? 1 : 0);
      applyPollStmt.run(
        update.state,
        update.checkStatus,
        update.failingChecks.length > 0 ? JSON.stringify(update.failingChecks) : null,
        update.unresolvedComments.length > 0 ? JSON.stringify(update.unresolvedComments) : null,
        update.prTitle ?? null,
        update.prBranch ?? null,
        needsAttentionSince,
        now,
        eventTimestamp,
        monitoring,
        now,
        prUrl,
      );
      return this.findByUrl(prUrl);
    },
  };
}
