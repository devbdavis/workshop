/**
 * Hook endpoints for the execution integration pipeline.
 *
 * - /hooks/agent-progress — SubagentStop HTTP hook: tracks which agents completed
 * - /hooks/session-end — SessionEnd command hook callback: safety net for completion
 */
import { Router } from 'express';
import type { WorkflowTicketId, ExecutionData } from '@foundation/types';
import type { WorkflowTicketRepository } from '@domain/workflow/repository';
import type { WorkflowEngine } from '@application/workflow/engine.js';
import { broadcast } from './events.js';

export interface ExecutionHookRouterDeps {
  engine: WorkflowEngine;
  tickets: WorkflowTicketRepository;
}

export function createExecutionHookRouter(deps: ExecutionHookRouterDeps): Router {
  const router = Router();
  const { engine, tickets } = deps;

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
   * SessionEnd hook — called by scripts/session-end-hook.sh when a Claude Code session ends.
   * Safety net: if the executing agent didn't self-report via MCP, transition to execution-failed.
   */
  router.post('/hooks/session-end', (req, res) => {
    try {
      const { session_id } = req.body;

      if (!session_id) {
        res.json({ ok: true });
        return;
      }

      const boundTicket = tickets.findByExecutionSessionId(session_id);

      if (!boundTicket || boundTicket.state !== 'executing') {
        res.json({ ok: true });
        return;
      }

      console.warn(
        `Execution session ${session_id} ended without reporting results. ` +
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

      res.json({ ok: true });
    } catch (err) {
      console.error('Session end hook error:', err);
      res.json({ ok: true });
    }
  });

  return router;
}
