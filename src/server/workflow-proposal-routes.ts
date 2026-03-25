/**
 * Workflow proposal routes — propose and approve workflow assignments for tickets.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { WorkflowTicketId, WorkflowState } from '@foundation/types.js';
import type { WorkflowTicketRepository } from '@domain/workflow/ticket-repository.js';
import type { WorkflowTemplateRepository } from '@domain/workflow/template-repository.js';
import type { AgentRoleRepository } from '@domain/workflow/agent-role-repository.js';
import type { TopologyLoader } from '@application/workflow/topology-loader.js';
import type { WorkflowEngine } from '@application/workflow/engine.js';
import type { DispatchCoordinator } from '@application/workflow/dispatch-coordinator.js';
import { StageDefinitionsSchema, AgentRoleSchema } from '@domain/workflow/schemas.js';
import { validateWorkflowGraph } from '@application/workflow/graph-validator.js';
import { broadcast } from './events.js';

// Zod schema for the full template payload (for validation during proposal)
const WorkflowTemplatePayloadSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  description: z.string().max(2000),
  ticketType: z.enum(['epic', 'task']),
  stageDefinitions: StageDefinitionsSchema,
  tags: z.array(z.string().max(64)).max(20).optional(),
  matchCriteria: z
    .object({
      keywords: z.array(z.string().max(64)).max(20),
      complexity: z.enum(['trivial', 'simple', 'moderate', 'complex']).optional(),
      domains: z.array(z.string().max(64)).max(10).optional(),
      requiresHumanGate: z.boolean().optional(),
    })
    .optional(),
  promptOverrides: z.record(z.string().max(128), z.string().max(10000)).optional(),
});

export interface WorkflowProposalRouterDeps {
  engine: WorkflowEngine;
  tickets: WorkflowTicketRepository;
  templates: WorkflowTemplateRepository;
  agentRoles: AgentRoleRepository;
  topologyLoader: TopologyLoader;
  /** Dispatch coordinator for triggering agent dispatch after workflow approval */
  dispatcher?: DispatchCoordinator;
}

export function createWorkflowProposalRouter(deps: WorkflowProposalRouterDeps): Router {
  const router = Router();
  const { engine, tickets, templates, agentRoles, topologyLoader, dispatcher } = deps;

  router.post('/workflow/tickets/:id/propose-workflow', (req, res) => {
    const ticketId = req.params.id as WorkflowTicketId;
    const { epicTemplate, taskTemplate, agentRoles: proposedRoles, rationale } = req.body;

    const ticket = tickets.findById(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (ticket.type !== 'epic') {
      return res.status(400).json({ error: 'Workflow proposals can only be made for epics' });
    }
    if (!epicTemplate) return res.status(400).json({ error: 'epicTemplate is required' });
    if (!rationale || typeof rationale !== 'string') {
      return res.status(400).json({ error: 'rationale is required' });
    }

    // Validate epic template
    const epicParseResult = WorkflowTemplatePayloadSchema.safeParse(epicTemplate);
    if (!epicParseResult.success) {
      res.status(400).json({
        error: 'Invalid epicTemplate',
        parseErrors: epicParseResult.error.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }

    // Validate epic graph
    const epicGraphResult = validateWorkflowGraph(epicParseResult.data.stageDefinitions);
    if (!epicGraphResult.valid) {
      res.status(400).json({
        error: 'Invalid epic workflow graph',
        graphErrors: epicGraphResult.errors,
        graphWarnings: epicGraphResult.warnings,
      });
      return;
    }

    // Validate task template if provided
    let validatedTaskTemplate = null;
    if (taskTemplate) {
      const taskParseResult = WorkflowTemplatePayloadSchema.safeParse(taskTemplate);
      if (!taskParseResult.success) {
        res.status(400).json({
          error: 'Invalid taskTemplate',
          parseErrors: taskParseResult.error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }

      const taskGraphResult = validateWorkflowGraph(taskParseResult.data.stageDefinitions);
      if (!taskGraphResult.valid) {
        res.status(400).json({
          error: 'Invalid task workflow graph',
          graphErrors: taskGraphResult.errors,
          graphWarnings: taskGraphResult.warnings,
        });
        return;
      }

      validatedTaskTemplate = taskParseResult.data;
    }

    // Validate agent roles if provided
    const validatedRoles: Array<z.infer<typeof AgentRoleSchema>> = [];
    if (proposedRoles && Array.isArray(proposedRoles)) {
      for (let i = 0; i < proposedRoles.length; i++) {
        const roleResult = AgentRoleSchema.safeParse(proposedRoles[i]);
        if (!roleResult.success) {
          res.status(400).json({
            error: `Invalid agentRole at index ${i}`,
            parseErrors: roleResult.error.errors.map((e) => ({
              path: e.path.join('.'),
              message: e.message,
            })),
          });
          return;
        }
        validatedRoles.push(roleResult.data);
      }
    }

    // Store proposal in stateData
    const existingStateData = (ticket.stateData || {}) as Record<string, unknown>;
    const workflowProposal = {
      epicTemplate: epicParseResult.data,
      taskTemplate: validatedTaskTemplate,
      agentRoles: validatedRoles.length > 0 ? validatedRoles : undefined,
      rationale,
      proposedAt: new Date().toISOString(),
    };

    const updated = tickets.update(ticketId, {
      stateData: { ...existingStateData, workflowProposal },
    });

    if (!updated) {
      res.status(500).json({ error: 'Failed to store workflow proposal' });
      return;
    }

    broadcast('workflow:updated', ticketId);
    res.json({
      message: 'Workflow proposal stored. Awaiting human approval.',
      ticketId,
      proposal: workflowProposal,
    });
  });

  router.post('/workflow/tickets/:id/approve-workflow', async (req, res) => {
    const ticketId = req.params.id as WorkflowTicketId;
    const ticket = tickets.findById(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const stateData = (ticket.stateData || {}) as Record<string, unknown>;
    const proposal = stateData.workflowProposal as {
      epicTemplate: z.infer<typeof WorkflowTemplatePayloadSchema>;
      taskTemplate?: z.infer<typeof WorkflowTemplatePayloadSchema>;
      agentRoles?: Array<z.infer<typeof AgentRoleSchema>>;
      rationale: string;
      proposedAt: string;
    } | undefined;

    if (!proposal) {
      return res.status(400).json({ error: 'No pending workflow proposal found on this ticket' });
    }

    try {
      // Create any new agent roles
      if (proposal.agentRoles && proposal.agentRoles.length > 0) {
        for (const roleData of proposal.agentRoles) {
          const existing = agentRoles.findById(roleData.id);
          if (!existing) {
            agentRoles.create({
              id: roleData.id,
              name: roleData.name,
              description: roleData.description,
              promptBlock: roleData.promptBlock,
              toolsAllowed: roleData.toolsAllowed,
              capabilityTier: roleData.capabilityTier,
              reusable: roleData.reusable ?? true,
            });
          }
        }
      }

      // Resolve epic template — reuse existing if the proposed ID is already in the library
      let epicTemplate = templates.findLatest(proposal.epicTemplate.id);
      if (!epicTemplate) {
        epicTemplate = templates.create({
          id: proposal.epicTemplate.id,
          version: 1,
          name: proposal.epicTemplate.name,
          description: proposal.epicTemplate.description,
          ticketType: proposal.epicTemplate.ticketType,
          stageDefinitions: proposal.epicTemplate.stageDefinitions,
          promptOverrides: proposal.epicTemplate.promptOverrides,
          tags: proposal.epicTemplate.tags,
          matchCriteria: proposal.epicTemplate.matchCriteria,
          usageCount: 0,
          parentTemplateId: undefined,
          createdBy: 'workflow-proposal',
        });
      }

      // Resolve task template — reuse existing if the proposed ID is already in the library
      let taskTemplateRow = null;
      if (proposal.taskTemplate) {
        taskTemplateRow = templates.findLatest(proposal.taskTemplate.id);
        if (!taskTemplateRow) {
          taskTemplateRow = templates.create({
            id: proposal.taskTemplate.id,
            version: 1,
            name: proposal.taskTemplate.name,
            description: proposal.taskTemplate.description,
            ticketType: proposal.taskTemplate.ticketType,
            stageDefinitions: proposal.taskTemplate.stageDefinitions,
            promptOverrides: proposal.taskTemplate.promptOverrides,
            tags: proposal.taskTemplate.tags,
            matchCriteria: proposal.taskTemplate.matchCriteria,
            usageCount: 0,
            parentTemplateId: epicTemplate.id,
            createdBy: 'workflow-proposal',
          });
        }
      }

      // Bind the template to the ticket
      const updatedStateData = { ...stateData };
      delete updatedStateData.workflowProposal;

      const updated = tickets.update(ticketId, {
        workflowTemplateRowId: epicTemplate.rowId,
        stateData: updatedStateData,
      });

      if (!updated) {
        res.status(500).json({ error: 'Failed to bind template to ticket' });
        return;
      }

      // Clear topology cache and increment usage
      topologyLoader.clearCache();
      templates.incrementUsage(epicTemplate.rowId);

      // Move to the template's entry state.
      // We set the state directly rather than using engine.transition() because
      // the pre-template state (e.g. 'idea') doesn't exist in the template's
      // topology, so transition validation would reject it.
      const stages = epicTemplate.stageDefinitions;
      const entryStage = stages.find(
        (s: Record<string, unknown>) => s.semanticRole === 'entry',
      ) ?? stages[0];
      const entryState = entryStage?.state as string | undefined;

      if (entryState && ticket.state !== entryState) {
        tickets.update(ticketId, {
          state: entryState as WorkflowState,
          stateChangedAt: new Date().toISOString(),
        });
      }

      // Dispatch agents for the entry state
      if (dispatcher) {
        try {
          await dispatcher.dispatchForCurrentState(ticketId);
        } catch (dispatchErr) {
          console.error('Failed to dispatch agents after workflow approval:', dispatchErr);
        }
      }

      broadcast('workflow:updated', ticketId);
      res.json({
        message: 'Workflow approved and applied',
        ticketId,
        epicTemplateRowId: epicTemplate.rowId,
        taskTemplateRowId: taskTemplateRow?.rowId ?? null,
        entryState,
      });
    } catch (err) {
      console.error('Workflow approval error:', err);
      const message = err instanceof Error ? err.message : 'Failed to approve workflow';
      res.status(500).json({ error: message });
    }
  });

  return router;
}
