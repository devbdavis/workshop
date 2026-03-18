import { Router } from 'express';
import type { PermissionRequestId, SessionId } from '@foundation/types';
import type { PermissionRequestRepository } from '@domain/permission/repository';
import { broadcast } from './events.js';

/** Max time (ms) the hook long-poll will wait for a user decision before timing out */
const HOOK_POLL_TIMEOUT = 86_400_000; // 24 hours
/** Poll interval (ms) for checking if a decision has been made */
const POLL_INTERVAL = 500;

/** Sessions that have been set to auto-approve all tool use (in-memory, resets on server restart) */
const autoApprovedSessions = new Set<string>();

/**
 * Tool invocations that are permanently auto-approved for all sessions.
 * Each entry is checked against tool_name (exact or prefix match) or,
 * for Bash commands, against the command string.
 *
 * This prevents background agents from getting stuck when calling back
 * into Workshop's own API (e.g. updating their todo status).
 */
const PERMANENTLY_APPROVED: Array<{
  tool?: string;
  toolPrefix?: string;
  bashCommandPattern?: RegExp;
}> = [
  // All Workshop MCP tool calls (in case the hook matcher is ever broadened)
  { toolPrefix: 'mcp__workshop__' },
  // Gmail MCP — allow background agents to create/send drafts
  { toolPrefix: 'mcp__claude_ai_Gmail__' },
  // Bash commands that curl the Workshop API
  { tool: 'Bash', bashCommandPattern: /^curl\s[^;|&`$]*localhost:\d+\/api\/[^;|&`$]*$/ },
  { tool: 'Bash', bashCommandPattern: /^curl\s[^;|&`$]*127\.0\.0\.1:\d+\/api\/[^;|&`$]*$/ },
];

/** Check if a tool invocation matches the permanent allowlist */
function isPermanentlyApproved(toolName: string, toolInput: Record<string, unknown>): boolean {
  for (const rule of PERMANENTLY_APPROVED) {
    if (rule.toolPrefix && toolName.startsWith(rule.toolPrefix)) return true;
    if (rule.tool && rule.tool === toolName && rule.bashCommandPattern) {
      const command = String(toolInput.command || '');
      if (rule.bashCommandPattern.test(command)) return true;
    }
  }
  return false;
}

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

      // If session is auto-approved, allow immediately without prompting
      if (autoApprovedSessions.has(sessionId)) {
        res.json(makeHookResponse('allow', 'Auto-approved (session-level)'));
        return;
      }

      // If tool is on the permanent allowlist, allow without prompting
      if (isPermanentlyApproved(tool_name, tool_input || {})) {
        res.json(makeHookResponse('allow', 'Permanently approved tool'));
        return;
      }

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

  // --- Auto-approve: allow all tool use for a session going forward ---

  router.post('/permissions/sessions/:sessionId/auto-approve', (req, res) => {
    const sessionId = req.params.sessionId;
    autoApprovedSessions.add(sessionId);

    // Also approve all currently pending requests for this session
    const pending = permissions.findPendingBySession(sessionId as SessionId);
    for (const p of pending) {
      permissions.resolve(p.id, 'approved', 'Auto-approved (session-level)');
    }

    broadcast('permission:resolved', sessionId);
    res.json({ sessionId, autoApprove: true, approvedCount: pending.length });
  });

  router.delete('/permissions/sessions/:sessionId/auto-approve', (req, res) => {
    const sessionId = req.params.sessionId;
    autoApprovedSessions.delete(sessionId);
    res.json({ sessionId, autoApprove: false });
  });

  router.get('/permissions/sessions/:sessionId/auto-approve', (req, res) => {
    const sessionId = req.params.sessionId;
    res.json({ sessionId, autoApprove: autoApprovedSessions.has(sessionId) });
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

/** Remove a session from the auto-approved set (e.g. when the session is destroyed). */
export function clearAutoApproval(sessionId: string): void {
  autoApprovedSessions.delete(sessionId);
}
