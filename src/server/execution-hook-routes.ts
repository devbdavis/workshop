/**
 * Hook endpoints for the execution integration pipeline.
 *
 * - /hooks/agent-progress — SubagentStop HTTP hook: tracks which agents completed
 * - /hooks/session-end — SessionEnd command hook callback: cleans up finished sessions
 */
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { Router } from 'express';
import type { SessionId, WorkflowTicketId, ExecutionData } from '@foundation/types';
import type { SessionRepository } from '@domain/session/repository.js';
import type { WorkflowTicketRepository } from '@domain/workflow/ticket-repository.js';
import type { WorkflowEngine } from '@application/workflow/engine.js';
import type { TerminalManager } from '@infrastructure/terminal/manager.js';
import type { ScheduledTaskRunRepository } from '@domain/scheduled-task/repository.js';
import type { UsageTracker } from '@infrastructure/usage/usage-tracker.js';
import { isAutonomous } from '@application/workflow/autonomy.js';
import { broadcast } from './events.js';

export interface ExecutionHookRouterDeps {
  engine: WorkflowEngine;
  tickets: WorkflowTicketRepository;
  terminal: TerminalManager;
  sessions: SessionRepository;
  taskRuns: ScheduledTaskRunRepository;
  /** Dark Factory usage pacing — calibrates the ceiling when a run hits the wall */
  usageTracker?: UsageTracker;
}

const SESSION_DATA_DIR = path.join(os.homedir(), '.workshop', 'sessions');

/**
 * Capture the full tmux scrollback and write it to <sessionDir>/output.txt.
 * The session dir persists for 7 days in the recycle bin — no SQLite blobs.
 */
function captureOutputToFile(sessionId: string, tmuxSession: string, maxLines = 500): void {
  try {
    const raw = execSync(
      `tmux capture-pane -t ${tmuxSession} -p -S -`,
      { stdio: 'pipe', encoding: 'utf-8', timeout: 5000 },
    );
    if (!raw.trim()) return;
    const lines = raw.split('\n');
    const content = lines.length > maxLines
      ? [`[... ${lines.length - maxLines} earlier lines omitted ...]`, ...lines.slice(-maxLines)].join('\n')
      : raw;
    const sessionDir = path.join(SESSION_DATA_DIR, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(path.join(sessionDir, 'output.txt'), content.trimEnd() + '\n', 'utf-8');
  } catch {
    // Non-fatal — tmux may already be gone or dir unwritable
  }
}

export function createExecutionHookRouter(deps: ExecutionHookRouterDeps): Router {
  const router = Router();
  const { engine, tickets, terminal, sessions, taskRuns, usageTracker } = deps;

  /**
   * StopFailure hook (matcher: rate_limit) — Dark Factory usage pacing backstop.
   * Fires when an autonomous run's turn ends on a usage-limit error. Calibrates
   * the usage ceiling from the token count at the wall and pauses the run; the
   * usage-pacing poller resumes it once the window drains below threshold.
   */
  router.post('/hooks/stop-failure', (req, res) => {
    try {
      const ticketId = req.headers['x-workshop-ticket'] as string | undefined;
      if (!ticketId) { res.json({}); return; }

      const ticket = tickets.findById(ticketId as WorkflowTicketId);
      if (!ticket || !isAutonomous(ticket, tickets)) { res.json({}); return; }

      const error = req.body?.error;
      if (error && error !== 'rate_limit') { res.json({}); return; }
      const banner = typeof req.body?.last_assistant_message === 'string'
        ? req.body.last_assistant_message
        : undefined;

      // Calibrate the ceiling: tokens burned this window ≈ the limit.
      if (usageTracker) {
        try {
          const { windowTokens } = usageTracker.readWindowTokens();
          usageTracker.recordCeiling(windowTokens);
        } catch (calErr) {
          console.warn('[dark-factory] usage ceiling calibration failed:', calErr);
        }
      }

      // 1h floor; the poller gates the real resume on the trailing window draining below threshold.
      const pausedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const sd = (ticket.stateData || {}) as Record<string, unknown>;
      tickets.update(ticket.id, {
        stateData: { ...sd, paused: true, pausedUntil, pausedReason: banner || 'Claude usage limit reached' },
      });
      broadcast('workflow:updated', ticket.id);
      console.warn(`[dark-factory] Ticket ${ticket.id} hit the usage wall — paused, will resume after reset.`);
      res.json({});
    } catch (err) {
      console.error('Stop-failure hook error:', err);
      res.json({});
    }
  });

  /**
   * SessionStart hook — Claude Code sends this when a session begins.
   * Captures the Claude session ID so we can later --resume it.
   */
  router.post('/hooks/session-start', (req, res) => {
    try {
      const workshopSessionId = req.headers['x-workshop-session'] as string | undefined;
      const claudeSessionId = req.body?.session_id;

      if (!workshopSessionId || !claudeSessionId) {
        res.json({});
        return;
      }

      const updated = sessions.updateClaudeResumeId(
        workshopSessionId as SessionId,
        claudeSessionId,
      );

      if (updated) {
        console.log(
          `Captured Claude session ID for ${workshopSessionId}: ${claudeSessionId}`,
        );
      }

      res.json({});
    } catch (err) {
      console.error('Session start hook error:', err);
      res.json({});
    }
  });

  /**
   * SubagentStop hook — Claude Code sends this when a Task-spawned sub-agent completes.
   * Updates the ticket's stateData.agentProgress to track pipeline progress.
   */
  router.post('/hooks/agent-progress', (req, res) => {
    try {
      const ticketId = req.headers['x-workshop-ticket'] as string | undefined;
      const sessionId = req.headers['x-workshop-session'] as string | undefined;

      if (!ticketId || !sessionId) {
        res.json({});
        return;
      }

      const ticket = tickets.findById(ticketId as WorkflowTicketId);
      if (!ticket || ticket.state !== 'executing') {
        res.json({});
        return;
      }

      const { subagent_type, subagent_result } = req.body;
      const agentRole = subagent_type || 'unknown';

      const existingData = (ticket.stateData || {}) as ExecutionData & Record<string, unknown>;
      const agentProgress = [...(existingData.agentProgress || [])];

      agentProgress.push({
        role: agentRole,
        status: 'completed',
        completedAt: new Date().toISOString(),
        summary: typeof subagent_result === 'string'
          ? subagent_result.slice(0, 500)
          : undefined,
      });

      tickets.update(ticket.id, {
        stateData: { ...existingData, agentProgress },
      });

      broadcast('workflow:progress', ticket.id);
      res.json({});
    } catch (err) {
      console.error('Agent progress hook error:', err);
      res.json({});
    }
  });

  /**
   * SessionEnd hook — called by scripts/session-end-hook.sh when ANY Claude session ends.
   * Two responsibilities:
   * 1. General cleanup: destroy the tmux session + DB record so it doesn't linger
   * 2. Workflow safety net: if a workflow execution agent didn't self-report, mark it failed
   */
  router.post('/hooks/session-end', async (req, res) => {
    try {
      const sessionId =
        (req.headers['x-workshop-session'] as string | undefined) ||
        req.body.session_id;

      if (!sessionId) {
        res.json({ ok: true });
        return;
      }

      console.log(`Session ${sessionId} ended — cleaning up`);

      // 1. Workflow safety net: check if this session was bound to a ticket
      const boundTicket = tickets.findByExecutionSessionId(sessionId);
      if (boundTicket && boundTicket.state === 'executing') {
        console.warn(
          `Execution session ${sessionId} ended without reporting results. ` +
          `Marking ticket ${boundTicket.id} as execution-failed.`,
        );
        try {
          engine.transition(
            boundTicket.id,
            'execution-failed',
            { type: 'system', reason: 'Session ended without completion report' },
            'Execution session terminated before reporting results. ' +
            'The agent may have crashed or timed out.',
          );
          broadcast('workflow:transitioned', boundTicket.id);
        } catch (transitionErr) {
          console.error('Failed to transition ticket on session end:', transitionErr);
        }
      }

      // 2. General cleanup: soft-delete the session into the recycle bin.
      // All sessions go to Recently Deleted on exit and are purged after 7 days.
      // Skip if already soft-deleted (user manually deleted, or sync loop retired it).
      // Exception: todo-dispatched background agents (background=true, no task run) stay
      // alive so the user can review or continue the conversation after it finishes.
      // Complete any scheduled-task run first — the sync loop often retires the session
      // before this hook lands, and the run must not be left 'running' when it does.
      let run: ReturnType<typeof taskRuns.findBySessionId> | undefined;
      try {
        run = taskRuns.findBySessionId(sessionId);
        if (run && run.status === 'running') {
          taskRuns.complete(run.id, 'completed');
          broadcast('scheduled-task:updated', run.taskId);
        }
      } catch (runErr) {
        console.warn(`Failed to complete scheduled task run for session ${sessionId}:`, runErr);
      }

      const session = sessions.findById(sessionId as SessionId);
      if (session?.deletedAt) {
        console.log(`Session ${sessionId} is already in the recycle bin — skipping`);
      } else if (session) {
        // Capture terminal output to <sessionDir>/output.txt before killing tmux.
        // The session dir persists for 7 days in the recycle bin — no SQLite blobs.
        // Todo-dispatched background agents: stay alive so the user can review the work.
        // Scheduled tasks (identified by a linked task run) and interactive sessions exit normally.
        const isTodoAgent = session.background && !run;
        if (isTodoAgent) {
          console.log(`Session ${sessionId} is a todo-dispatched agent — keeping alive after exit`);
          if (session.tmuxSession) {
            captureOutputToFile(sessionId, session.tmuxSession);
          }
        } else {
          if (session.tmuxSession) {
            captureOutputToFile(sessionId, session.tmuxSession);
          }
          try {
            await terminal.softDeleteSession(sessionId as SessionId);
            broadcast('session:deleted', sessionId);
          } catch (destroyErr) {
            console.error(`Failed to soft-delete session ${sessionId}:`, destroyErr);
          }
        }
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('Session end hook error:', err);
      res.json({ ok: true });
    }
  });

  return router;
}
