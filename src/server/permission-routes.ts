import { Router } from 'express';
import type { PermissionRequestId, SessionId } from '@foundation/types';
import type { PermissionRequestRepository } from '@domain/permission/repository';
import { broadcast } from './events.js';

/** Max time (ms) the hook long-poll will wait for a user decision before timing out */
const HOOK_POLL_TIMEOUT = 300_000; // 5 minutes
/** Poll interval (ms) for checking if a decision has been made */
const POLL_INTERVAL = 500;

export interface PermissionRouterDeps {
  permissions: PermissionRequestRepository;
}

export function createPermissionRouter(deps: PermissionRouterDeps): Router {
  const router = Router();
  const { permissions } = deps;

  // --- Hook endpoint: receives PreToolUse from Claude Code ---
  // Claude Code blocks until we respond, so we long-poll until the user decides.

  router.post('/hooks/permission', async (req, res) => {
    try {
      const { session_id, tool_name, tool_input } = req.body;

      if (!session_id || !tool_name) {
        // Not a valid hook payload — allow by default
        res.json(makeHookResponse('allow'));
        return;
      }

      // Look up session ID from the env var we set when launching the agent
      const sessionId = (req.headers['x-workshop-session'] as string) || session_id;

      // Create a pending permission request
      const request = permissions.create({
        sessionId: sessionId as SessionId,
        toolName: tool_name,
        toolInput: tool_input || {},
        decision: 'pending',
      });

      // Notify the UI via WebSocket
      broadcast('permission:requested', sessionId);

      // Long-poll: wait for user to approve/deny
      const deadline = Date.now() + HOOK_POLL_TIMEOUT;
      const result = await pollForDecision(request.id, deadline);

      if (!result) {
        // Timeout — deny by default
        permissions.resolve(request.id, 'denied', 'Timed out waiting for approval');
        res.json(makeHookResponse('deny', 'Permission request timed out (5m)'));
        return;
      }

      if (result.decision === 'approved') {
        const context = result.userComment
          ? `User approved with comment: ${result.userComment}`
          : undefined;
        res.json(makeHookResponse('allow', result.decisionReason, context));
      } else {
        const reason = result.decisionReason || 'User denied this operation';
        const context = result.userComment
          ? `User comment: ${result.userComment}`
          : undefined;
        res.json(makeHookResponse('deny', reason, context));
      }
    } catch (err) {
      console.error('Permission hook error:', err);
      // On error, fall through to normal permission handling
      res.json(makeHookResponse('ask'));
    }
  });

  // --- List permission requests (with optional filters) ---

  router.get('/permissions', (req, res) => {
    const { sessionId, status } = req.query;
    if (sessionId) {
      if (status === 'pending') {
        res.json(permissions.findPendingBySession(sessionId as SessionId));
      } else {
        res.json(permissions.findBySession(sessionId as SessionId));
      }
      return;
    }
    // No general findAll to avoid large queries — require sessionId
    res.status(400).json({ error: 'sessionId query param is required' });
  });

  // --- Resolve a permission request (approve/deny from the UI) ---

  router.put('/permissions/:id', (req, res) => {
    const { decision, reason, comment } = req.body;
    if (!decision || (decision !== 'approved' && decision !== 'denied')) {
      res.status(400).json({ error: 'decision must be "approved" or "denied"' });
      return;
    }

    const updated = permissions.resolve(
      req.params.id as PermissionRequestId,
      decision,
      reason,
      comment,
    );

    if (!updated) {
      res.status(404).json({ error: 'Permission request not found' });
      return;
    }

    broadcast('permission:resolved', updated.sessionId);
    res.json(updated);
  });

  // --- Poll helper: checks DB until resolved or timeout ---

  async function pollForDecision(id: PermissionRequestId, deadline: number) {
    while (Date.now() < deadline) {
      const current = permissions.findById(id);
      if (current && current.decision !== 'pending') {
        return current;
      }
      await sleep(POLL_INTERVAL);
    }
    return null;
  }

  return router;
}

// --- Helpers ---

function makeHookResponse(
  decision: 'allow' | 'deny' | 'ask',
  reason?: string,
  additionalContext?: string,
) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      ...(reason && { permissionDecisionReason: reason }),
      ...(additionalContext && { additionalContext }),
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
