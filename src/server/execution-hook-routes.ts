/**
 * Hook endpoints for the execution integration pipeline.
 *
 * - /hooks/agent-progress — SubagentStop HTTP hook: tracks which agents completed
 * - /hooks/session-end — SessionEnd command hook callback: safety net for completion
 */
import { Router } from 'express';
import type { WorkflowTicketId, SessionId, ExecutionData } from '@foundation/types';
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
   * Updates the ticket's execution_data.agentProgress to track pipeline progress.
   */
  router.post('/hooks/agent-progress', (req, res) => {
    try {
      const ticketId = req.headers['x-workshop-ticket'] as string | undefined;
      const sessionId = req.headers['x-workshop-session'] as string | undefined;

      if (!ticketId || !sessionId) {
        // Not a tracked execution session — ignore silently
        res.json({});
        return;
      }

      const ticket = tickets.findById(ticketId as WorkflowTicketId);
      if (!ticket || ticket.state !== 'executing') {
        res.json({});
        return;
      }

      // Extract agent info from the hook payload
      // SubagentStop payload includes: hook_event_name, subagent_type, subagent_result
      const { subagent_type, subagent_result } = req.body;
      const agentRole = subagent_type || 'unknown';

      // Update execution data with agent progress
      const existingData = (ticket.stateData as ExecutionData) || {};
      const agentProgress = existingData.agentProgress || [];

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
      res.json({}); // Non-blocking — don't fail the hook
    }
  });

  /**
   * SessionEnd hook — called by scripts/session-end-hook.sh when a Claude Code session ends.
   * Acts as a safety net: if the executing agent didn't self-report via MCP, this
   * transitions the ticket to execution-failed so it doesn't get stuck.
   */
  router.post('/hooks/session-end', (req, res) => {
    try {
      const { session_id } = req.body;

      if (!session_id) {
        res.json({ ok: true });
        return;
      }

      // Find any workflow ticket bound to this execution session
      const executingTickets = tickets.findByState('executing');
      const boundTicket = executingTickets.find(
        (t) => t.executionSessionId === session_id,
      );

      if (!boundTicket) {
        // No ticket bound to this session — nothing to do
        res.json({ ok: true });
        return;
      }

      // If ticket is still in 'executing' state, the agent didn't self-report.
      // Transition to execution-failed as a safety net.
      if (boundTicket.state === 'executing') {
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
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('Session end hook error:', err);
      res.json({ ok: true }); // Non-blocking
    }
  });

  return router;
}
