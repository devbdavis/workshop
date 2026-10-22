import type { PermissionRepository } from '@domain/permissions/repository';
import type {
  PermissionDecision,
  PermissionHarness,
  PermissionRequest,
  PermissionRequestId,
  PermissionRule,
} from '@foundation/permission-types';
import type { SessionId, TrackId } from '@foundation/types';
import { normalizeTool, ruleMatches, suggestPattern, summarize } from './rules.js';

export type HookDecision = PermissionDecision | 'none';

export interface PermissionServiceDeps {
  repo: PermissionRepository;
  broadcast: (
    type: 'permission:requested' | 'permission:decided',
    trackId: string,
    payload: Record<string, unknown>,
  ) => void;
  resolveTask: (sessionId: SessionId) => { trackId: TrackId | null; taskName: string };
  now?: () => number;
  timeoutMs?: number;
  grantTtlMs?: number;
}

export interface RequestInput {
  sessionId: SessionId;
  harness: PermissionHarness;
  toolName: string;
  toolInput: unknown;
  reason?: string;
}

export type DecideResult =
  | { error: 'not-found' | 'not-pending' | 'bad-pattern' }
  | { request: PermissionRequest; rule?: PermissionRule };

interface Waiter {
  resolve: (d: HookDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createPermissionService(deps: PermissionServiceDeps) {
  const { repo } = deps;
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? 540_000;
  const grantTtlMs = deps.grantTtlMs ?? 600_000;
  const waiters = new Map<string, Waiter>();
  // One-shot grants let Claude's retry after an approval through; a grant still present when the
  // same call is denied again means the approval didn't get past auto mode, so stop asking.
  const grants = new Map<string, { exp: number; usedAt?: number }>();

  const grantKey = (s: SessionId, tool: string, input: unknown) =>
    `${s}\u0000${normalizeTool(tool)}\u0000${JSON.stringify(input ?? null)}`;

  function liveGrant(key: string) {
    const g = grants.get(key);
    if (g && g.exp <= now()) grants.delete(key);
    return g && g.exp > now() ? g : undefined;
  }

  function findRule(
    decision: PermissionDecision,
    tool: string,
    input: unknown,
  ): PermissionRule | undefined {
    return repo.listRules().find((r) => r.decision === decision && ruleMatches(r, tool, input));
  }

  function settle(id: string, status: 'expired', decision: HookDecision): PermissionRequest | null {
    const w = waiters.get(id);
    if (!w) return null;
    clearTimeout(w.timer);
    waiters.delete(id);
    const req = repo.updateRequestStatus(id as PermissionRequestId, status);
    if (req) deps.broadcast('permission:decided', req.trackId ?? '', { request: req });
    w.resolve(decision);
    return req;
  }

  function submit(input: RequestInput): { id: string | null; result: Promise<HookDecision> } {
    const normalizedTool = normalizeTool(input.toolName);
    const { trackId, taskName } = deps.resolveTask(input.sessionId);
    const base = {
      sessionId: input.sessionId,
      trackId,
      taskName,
      harness: input.harness,
      toolName: input.toolName,
      normalizedTool,
      summary: summarize(input.toolName, input.toolInput),
      toolInput: input.toolInput,
      reason: input.reason,
      suggestedPattern: suggestPattern(input.toolName, input.toolInput),
    };
    const auto = (
      status: 'auto-declined' | 'auto-approved',
      rule: PermissionRule,
      d: PermissionDecision,
    ) => {
      const request = repo.createRequest({ ...base, status, ruleId: rule.id });
      deps.broadcast('permission:decided', trackId ?? '', { request });
      return { id: request.id as string, result: Promise.resolve<HookDecision>(d) };
    };

    const key = grantKey(input.sessionId, input.toolName, input.toolInput);
    const g = input.harness === 'claude' ? liveGrant(key) : undefined;
    grants.delete(key);
    if (g && (g.usedAt === undefined || now() - g.usedAt < 60_000)) {
      return { id: null, result: Promise.resolve('none') };
    }

    const deny = findRule('deny', input.toolName, input.toolInput);
    if (deny) return auto('auto-declined', deny, 'deny');
    const allow = findRule('allow', input.toolName, input.toolInput);
    if (allow) {
      if (input.harness === 'claude') grants.set(key, { exp: now() + grantTtlMs });
      return auto('auto-approved', allow, 'allow');
    }

    const request = repo.createRequest({ ...base, status: 'pending' });
    deps.broadcast('permission:requested', trackId ?? '', { request });
    const result = new Promise<HookDecision>((resolve) => {
      const timer = setTimeout(() => settle(request.id, 'expired', 'none'), timeoutMs);
      waiters.set(request.id, { resolve, timer });
    });
    return { id: request.id, result };
  }

  function decide(
    id: PermissionRequestId,
    body: { decision: PermissionDecision; always?: boolean; pattern?: string | null },
  ): DecideResult {
    const request = repo.findRequestById(id);
    if (!request) return { error: 'not-found' };
    if (request.status !== 'pending') return { error: 'not-pending' };

    let rule: PermissionRule | undefined;
    if (body.always) {
      let pattern: string | null = null;
      if (request.normalizedTool === 'shell') {
        pattern = (body.pattern ?? request.suggestedPattern)?.trim() || null;
        if (!pattern) return { error: 'bad-pattern' };
      }
      rule = repo.createRule({
        toolName: request.normalizedTool,
        pattern,
        decision: body.decision,
        sourceRequestId: id,
      });
    }
    const status = body.decision === 'allow' ? 'approved' : 'declined';
    const updated = repo.updateRequestStatus(id, status, rule?.id)!;
    if (body.decision === 'allow') {
      grants.set(grantKey(request.sessionId, request.toolName, request.toolInput), {
        exp: now() + grantTtlMs,
      });
    }
    const w = waiters.get(id);
    if (w) {
      clearTimeout(w.timer);
      waiters.delete(id);
      w.resolve(body.decision);
    }
    deps.broadcast('permission:decided', updated.trackId ?? '', {
      request: updated,
      ...(rule ? { rule } : {}),
    });
    return { request: updated, rule };
  }

  function check(sessionId: SessionId, toolName: string, toolInput: unknown): 'allow' | 'none' {
    const g = liveGrant(grantKey(sessionId, toolName, toolInput));
    if (g && g.usedAt === undefined) {
      g.usedAt = now();
      return 'allow';
    }
    return findRule('allow', toolName, toolInput) ? 'allow' : 'none';
  }

  return {
    submit,
    decide,
    check,
    /** Client went away before a decision. */
    expire: (id: string) => settle(id, 'expired', 'none'),
  };
}

export type PermissionService = ReturnType<typeof createPermissionService>;
