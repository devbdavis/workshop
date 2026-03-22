import { Router } from 'express';
import type { PermissionRequestId, SessionId } from '@foundation/types';
import type { PermissionRequestRepository } from '@domain/permission/repository';
import { getDatabase } from '@infrastructure/persistence/database.js';
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
 * This prevents background agents from getting stuck on safe, read-only
 * operations. Mirrors the safe command set from claude-approve config.
 */
const PERMANENTLY_APPROVED: Array<{
  tool?: string;
  toolPrefix?: string;
  bashCommandPattern?: RegExp;
}> = [
  // --- MCP tools ---
  { toolPrefix: 'mcp__workshop__' },
  { toolPrefix: 'mcp__claude_ai_Gmail__' },
  { toolPrefix: 'mcp__claude_ai_Atlassian__' },
  { toolPrefix: 'mcp__claude_ai_Linear__' },
  { toolPrefix: 'mcp__claude_ai_Google_Calendar__' },
  { toolPrefix: 'mcp__glean-developer-docs__' },
  { toolPrefix: 'mcp__replicate__' },
  { toolPrefix: 'mcp__MCP_DOCKER__' },

  // --- Read-only file and search commands ---
  { tool: 'Bash', bashCommandPattern: /^(cat|head|tail|less|more|wc|file|stat)(\s|$)/ },
  { tool: 'Bash', bashCommandPattern: /^(grep|rg|ag|ack|fgrep|egrep)(\s|$)/ },
  { tool: 'Bash', bashCommandPattern: /^(ls|ll|la|tree|exa|fd)(\s|$)/ },
  { tool: 'Bash', bashCommandPattern: /^find\s/ },
  { tool: 'Bash', bashCommandPattern: /^(echo|printf)(\s|$)/ },
  { tool: 'Bash', bashCommandPattern: /^(pwd|whoami|hostname|uname|date|env|printenv|id|which|type|command\s+-v)(\s|$)/ },

  // --- Text processing ---
  { tool: 'Bash', bashCommandPattern: /^(sed|awk|sort|uniq|cut|tr|tee|diff|comm|paste|column)(\s|$)/ },
  { tool: 'Bash', bashCommandPattern: /^(jq|yq|xq)(\s|$)/ },

  // --- Git (read-only) ---
  { tool: 'Bash', bashCommandPattern: /^git\s+(status|log|diff|show|branch|tag|remote|stash\s+list|ls-files|blame|describe|rev-parse|config\s+--get|reflog|rev-list|merge-base)(\s|$)/ },
  // --- Git (write — agents need to commit their work) ---
  { tool: 'Bash', bashCommandPattern: /^git\s+(add|commit|checkout|switch|stash|fetch|pull|merge|rebase|cherry-pick|worktree)(\s|$)/ },
  // --- Git push (without force) ---
  { tool: 'Bash', bashCommandPattern: /^git\s+push(\s|$)/ },

  // --- Build/runtime tools ---
  { tool: 'Bash', bashCommandPattern: /^(npm|npx|node|tsx|ts-node)(\s|$)/ },
  { tool: 'Bash', bashCommandPattern: /^(python|python3)(\s|$)/ },
  { tool: 'Bash', bashCommandPattern: /^(make|cargo|go)(\s|$)/ },

  // --- GitHub CLI ---
  { tool: 'Bash', bashCommandPattern: /^gh\s+/ },

  // --- Shell navigation and piping helpers ---
  { tool: 'Bash', bashCommandPattern: /^cd\s/ },
  { tool: 'Bash', bashCommandPattern: /^(bash|sh|source|\.)(\s|$)/ },
  { tool: 'Bash', bashCommandPattern: /^(mkdir|touch|cp|mv|ln|chmod)(\s|$)/ },
  { tool: 'Bash', bashCommandPattern: /^sleep\s/ },

  // --- Workshop-specific ---
  { tool: 'Bash', bashCommandPattern: /scripts\/workshop\.sh\s+(start|stop|restart|status|logs)/ },
  { tool: 'Bash', bashCommandPattern: /^curl\s[^;|&`$]*localhost:\d+\/api\// },
  { tool: 'Bash', bashCommandPattern: /^curl\s[^;|&`$]*127\.0\.0\.1:\d+\/api\// },

  // --- Local/home/absolute scripts ---
  { tool: 'Bash', bashCommandPattern: /^\.\/|^~\/|^\/Users\// },

  // --- Database CLI ---
  { tool: 'Bash', bashCommandPattern: /^sqlite3\s/ },

  // --- Docker (read-only + build/run) ---
  { tool: 'Bash', bashCommandPattern: /^docker\s+(ps|images|inspect|logs|stats|build|run|compose|exec|pull)(\s|$)/ },

  // --- HTTP tools ---
  { tool: 'Bash', bashCommandPattern: /^(curl|wget)(\s|$)/ },

  // --- Env var prefix before safe commands ---
  { tool: 'Bash', bashCommandPattern: /^[A-Z_]+=\S*\s+(pytest|python|python3|node|npm|go|make|cargo)\s/ },
];

/**
 * Commands that should ALWAYS be denied, even if individual segments look safe.
 * Checked against the full unsplit command string.
 */
const DENY_PATTERNS: RegExp[] = [
  /rm\s+.*-r.*f|rm\s+.*-f.*r/,     // rm -rf
  /git\s+push\s+.*--force|git\s+push\s+-f\s/,  // force push
  /git\s+reset\s+--hard/,           // hard reset
  /git\s+clean\s+-f/,               // clean -f
  /^terraform\s+/,                   // terraform commands
];

/**
 * Split a shell command into logical segments on && || | ; operators.
 * Respects quoted strings so pipes inside quotes don't cause false splits.
 */
function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  while (i < command.length) {
    const ch = command[i];
    const next = command[i + 1];

    if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; i++; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; i++; continue; }
    if (ch === '\\') { current += ch + (next || ''); i += 2; continue; }

    if (!inSingle && !inDouble) {
      if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
        segments.push(current.trim());
        current = '';
        i += 2;
        continue;
      }
      if (ch === '|' || ch === ';') {
        segments.push(current.trim());
        current = '';
        i++;
        continue;
      }
    }

    current += ch;
    i++;
  }

  if (current.trim()) segments.push(current.trim());
  return segments.filter((s) => s.length > 0);
}

/** Check if a single command segment matches any allow pattern */
function segmentMatchesAllow(segment: string): boolean {
  // Strip leading env var assignments (e.g., FOO=bar command ...)
  const stripped = segment.replace(/^([A-Z_]+=\S*\s+)+/, '');
  // Strip redirects (2>/dev/null, >/tmp/foo, etc.)
  const noRedirects = stripped.replace(/\s*\d*>[>&]?\s*\S+/g, '').trim();

  for (const rule of PERMANENTLY_APPROVED) {
    if (rule.bashCommandPattern && rule.tool === 'Bash') {
      if (rule.bashCommandPattern.test(noRedirects)) return true;
    }
  }
  return false;
}

/** Check if a tool invocation matches the permanent allowlist */
function isPermanentlyApproved(toolName: string, toolInput: Record<string, unknown>): boolean {
  // Non-Bash tools: check prefix/exact matches
  for (const rule of PERMANENTLY_APPROVED) {
    if (rule.toolPrefix && toolName.startsWith(rule.toolPrefix)) return true;
  }

  if (toolName !== 'Bash') return false;

  const command = String(toolInput.command || '');
  if (!command) return false;

  // Check deny patterns against the full command first
  for (const deny of DENY_PATTERNS) {
    if (deny.test(command)) return false;
  }

  // Split into segments and verify each one
  const segments = splitShellSegments(command);
  if (segments.length === 0) return false;

  return segments.every(segmentMatchesAllow);
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

  // --- List all pending permissions across all sessions (enriched with track/session info) ---

  router.get('/permissions/pending', (_req, res) => {
    try {
      const pending = permissions.findAllPending();
      // Enrich with session/track info using a single JOIN query
      const db = getDatabase();
      const enrichStmt = db.prepare(`
        SELECT s.track_id, s.name as session_name, s.tmux_session, t.name as track_name
        FROM sessions s
        LEFT JOIN tracks t ON t.id = s.track_id
        WHERE s.id = ?
      `);
      const enriched = pending.map((p) => {
        const info = enrichStmt.get(p.sessionId) as {
          track_id: string; session_name: string | null; tmux_session: string; track_name: string | null;
        } | undefined;
        return {
          ...p,
          trackId: info?.track_id,
          trackName: info?.track_name ?? 'Unknown',
          sessionName: info?.session_name || info?.tmux_session || p.sessionId.slice(0, 8),
        };
      });
      res.json(enriched);
    } catch (err) {
      console.error('Failed to list pending permissions:', err);
      res.status(500).json({ error: 'Internal server error' });
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
