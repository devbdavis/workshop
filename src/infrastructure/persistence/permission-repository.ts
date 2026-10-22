import { v4 as uuid } from 'uuid';
import { getDatabase } from './database.js';
import type { PermissionRepository } from '@domain/permissions/repository';
import type {
  PermissionDecision,
  PermissionHarness,
  PermissionRequest,
  PermissionRequestId,
  PermissionRequestStatus,
  PermissionRule,
  PermissionRuleId,
} from '@foundation/permission-types';
import type { SessionId, TrackId } from '@foundation/types';

interface RequestRow {
  id: string;
  session_id: string;
  track_id: string | null;
  task_name: string;
  harness: string;
  tool_name: string;
  normalized_tool: string;
  summary: string;
  tool_input: string;
  reason: string | null;
  suggested_pattern: string | null;
  status: string;
  rule_id: string | null;
  created_at: string;
  decided_at: string | null;
}

interface RuleRow {
  id: string;
  tool_name: string;
  pattern: string | null;
  decision: string;
  source_request_id: string | null;
  created_at: string;
}

function parseInput(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function rowToRequest(r: RequestRow): PermissionRequest {
  return {
    id: r.id as PermissionRequestId,
    sessionId: r.session_id as SessionId,
    trackId: (r.track_id as TrackId | null) ?? null,
    taskName: r.task_name,
    harness: r.harness as PermissionHarness,
    toolName: r.tool_name,
    normalizedTool: r.normalized_tool,
    summary: r.summary,
    toolInput: parseInput(r.tool_input),
    reason: r.reason ?? undefined,
    suggestedPattern: r.suggested_pattern,
    status: r.status as PermissionRequestStatus,
    ruleId: (r.rule_id as PermissionRuleId | null) ?? undefined,
    createdAt: r.created_at,
    decidedAt: r.decided_at ?? undefined,
  };
}

function rowToRule(r: RuleRow): PermissionRule {
  return {
    id: r.id as PermissionRuleId,
    toolName: r.tool_name,
    pattern: r.pattern,
    decision: r.decision as PermissionDecision,
    sourceRequestId: (r.source_request_id as PermissionRequestId | null) ?? undefined,
    createdAt: r.created_at,
  };
}

export function createPermissionRepository(): PermissionRepository {
  const db = getDatabase();
  const insertReq = db.prepare(
    `INSERT INTO permission_requests (id, session_id, track_id, task_name, harness, tool_name, normalized_tool,
       summary, tool_input, reason, suggested_pattern, status, rule_id, created_at, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const findReq = db.prepare('SELECT * FROM permission_requests WHERE id = ?');
  const listReqs = db.prepare(
    `SELECT * FROM permission_requests
     WHERE (@status IS NULL OR status = @status) AND (@tool IS NULL OR normalized_tool = @tool)
     ORDER BY created_at DESC, rowid DESC LIMIT @limit`,
  );
  const updateReq = db.prepare(
    'UPDATE permission_requests SET status = ?, rule_id = COALESCE(?, rule_id), decided_at = ? WHERE id = ?',
  );
  const listRulesStmt = db.prepare(
    'SELECT * FROM permission_rules ORDER BY created_at DESC, rowid DESC',
  );
  const findRule = db.prepare('SELECT * FROM permission_rules WHERE id = ?');
  const insertRule = db.prepare(
    'INSERT INTO permission_rules (id, tool_name, pattern, decision, source_request_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const deleteRule = db.prepare('DELETE FROM permission_rules WHERE id = ?');

  const getReq = (id: string) => {
    const row = findReq.get(id) as RequestRow | undefined;
    return row ? rowToRequest(row) : null;
  };

  return {
    createRequest(d) {
      const id = uuid();
      const now = new Date().toISOString();
      // Auto-decided requests are born decided.
      const decidedAt = d.status === 'pending' ? null : now;
      insertReq.run(
        id,
        d.sessionId,
        d.trackId,
        d.taskName,
        d.harness,
        d.toolName,
        d.normalizedTool,
        d.summary,
        JSON.stringify(d.toolInput ?? null),
        d.reason ?? null,
        d.suggestedPattern,
        d.status,
        d.ruleId ?? null,
        now,
        decidedAt,
      );
      return getReq(id)!;
    },
    findRequestById: (id) => getReq(id),
    listRequests: (o) =>
      (
        listReqs.all({
          status: o.status ?? null,
          tool: o.normalizedTool ?? null,
          limit: o.limit,
        }) as RequestRow[]
      ).map(rowToRequest),
    updateRequestStatus(id, status, ruleId) {
      updateReq.run(status, ruleId ?? null, new Date().toISOString(), id);
      return getReq(id);
    },
    listRules: () => (listRulesStmt.all() as RuleRow[]).map(rowToRule),
    findRuleById(id) {
      const row = findRule.get(id) as RuleRow | undefined;
      return row ? rowToRule(row) : null;
    },
    createRule(d) {
      const id = uuid();
      insertRule.run(
        id,
        d.toolName,
        d.pattern,
        d.decision,
        d.sourceRequestId ?? null,
        new Date().toISOString(),
      );
      return rowToRule(findRule.get(id) as RuleRow);
    },
    deleteRule: (id) => deleteRule.run(id).changes > 0,
  };
}
