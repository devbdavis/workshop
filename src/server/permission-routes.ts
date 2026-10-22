/** /permissions — CLI hooks ask Workshop about blocked tool calls; the UI decides. */
import { Router } from 'express';
import type { Request } from 'express';
import type { PermissionService } from '@application/permissions/permission-service.js';
import type { PermissionRepository } from '@domain/permissions/repository';
import type {
  PermissionHarness,
  PermissionRequestId,
  PermissionRequestStatus,
  PermissionRuleId,
} from '@foundation/permission-types';
import type { SessionId } from '@foundation/types';

const HARNESSES = ['claude', 'codex', 'gemini'];
const SESSION_RE = /^[a-zA-Z0-9_-]+$/;
const STATUSES = ['pending', 'approved', 'declined', 'expired', 'auto-approved', 'auto-declined'];

export function createPermissionRouter(deps: {
  repo: PermissionRepository;
  service: PermissionService;
}): Router {
  const router = Router();
  const { repo, service } = deps;

  function parseHookBody(req: Request) {
    const sessionId = req.headers['x-workshop-session'];
    const b = req.body ?? {};
    if (typeof sessionId !== 'string' || !SESSION_RE.test(sessionId)) return null;
    if (!HARNESSES.includes(b.harness)) return null;
    if (typeof b.toolName !== 'string' || !b.toolName) return null;
    return {
      sessionId: sessionId as SessionId,
      harness: b.harness as PermissionHarness,
      toolName: b.toolName as string,
      toolInput: b.toolInput ?? {},
      reason: typeof b.reason === 'string' ? b.reason : undefined,
    };
  }

  router.post('/permissions/requests', async (req, res) => {
    const input = parseHookBody(req);
    if (!input) {
      res.status(400).json({ error: 'invalid session header, harness or toolName' });
      return;
    }
    try {
      const { id, result } = service.submit(input);
      // Client gave up (hook timed out or CLI exited) before a decision.
      if (id) res.on('close', () => service.expire(id));
      res.json({ decision: await result });
    } catch (err) {
      console.error('[permissions] request failed:', err);
      res.status(500).json({ error: 'permission request failed' });
    }
  });

  router.post('/permissions/check', (req, res) => {
    const input = parseHookBody(req);
    if (!input) {
      res.status(400).json({ error: 'invalid session header, harness or toolName' });
      return;
    }
    res.json({ decision: service.check(input.sessionId, input.toolName, input.toolInput) });
  });

  router.get('/permissions/requests', (req, res) => {
    const { status, toolName, limit } = req.query;
    if (status !== undefined && status !== 'all' && !STATUSES.includes(String(status))) {
      res.status(400).json({ error: 'invalid status' });
      return;
    }
    const n = Math.min(Math.max(parseInt(String(limit ?? '50'), 10) || 50, 1), 200);
    res.json(
      repo.listRequests({
        status: status && status !== 'all' ? (status as PermissionRequestStatus) : undefined,
        normalizedTool: typeof toolName === 'string' && toolName ? toolName : undefined,
        limit: n,
      }),
    );
  });

  router.post('/permissions/requests/:id/decide', (req, res) => {
    const { decision, always, pattern } = req.body ?? {};
    if (decision !== 'allow' && decision !== 'deny') {
      res.status(400).json({ error: 'decision must be allow or deny' });
      return;
    }
    if (pattern !== undefined && pattern !== null && typeof pattern !== 'string') {
      res.status(400).json({ error: 'pattern must be a string or null' });
      return;
    }
    const out = service.decide(req.params.id as PermissionRequestId, {
      decision,
      always: always === true,
      pattern,
    });
    if ('error' in out) {
      const code = { 'not-found': 404, 'not-pending': 409, 'bad-pattern': 400 }[out.error];
      res.status(code).json({ error: out.error });
      return;
    }
    res.json(out);
  });

  router.get('/permissions/rules', (_req, res) => {
    res.json(repo.listRules());
  });

  router.delete('/permissions/rules/:id', (req, res) => {
    repo.deleteRule(req.params.id as PermissionRuleId);
    res.status(204).end();
  });

  return router;
}
