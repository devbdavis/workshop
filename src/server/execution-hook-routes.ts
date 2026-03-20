/**
 * Hook endpoints for the execution integration pipeline.
 *
 * - /hooks/agent-progress — SubagentStop HTTP hook: tracks which agents completed
 * - /hooks/session-end — SessionEnd command hook callback: cleans up finished sessions
 */
import { Router } from 'express';
import type { SessionId, WorkflowTicketId, ExecutionData } from '@foundation/types';
import type { WorkflowTicketRepository } from '@domain/workflow/repository';
import type { WorkflowEngine } from '@application/workflow/engine.js';
import type { TerminalManager } from '@infrastructure/terminal/manager.js';
import { broadcast } from './events.js';

export interface ExecutionHookRouterDeps {
  engine: WorkflowEngine;
  tickets: WorkflowTicketRepository;
  terminal: TerminalManager;
}

export function createExecutionHookRouter(deps: ExecutionHookRouterDeps): Router {
  const router = Router();
  const { engine, tickets, terminal } = deps;

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

      // 2. General cleanup: destroy the session (tmux + DB + session dir)
      try {
        await terminal.destroySession(sessionId as SessionId);
        broadcast('session:deleted', sessionId);
      } catch (destroyErr) {
        console.error(`Failed to destroy session ${sessionId}:`, destroyErr);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('Session end hook error:', err);
      res.json({ ok: true });
    }
  });

  return router;
}
