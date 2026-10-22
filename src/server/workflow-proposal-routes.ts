/**
 * Workflow proposal routes — propose and approve workflow assignments for issues.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { WorkflowIssueId, WorkflowState } from '@foundation/types.js';
import type { WorkflowIssueRepository } from '@domain/workflow/issue-repository.js';
import type { PlaybookRepository } from '@domain/workflow/playbook-repository.js';
import type { AgentRoleRepository } from '@domain/workflow/agent-role-repository.js';
import type { TopologyLoader } from '@application/workflow/topology-loader.js';
import type { WorkflowEngine } from '@application/workflow/engine.js';
import type { DispatchCoordinator } from '@application/workflow/dispatch-coordinator.js';
import { StageDefinitionsSchema, AgentRoleSchema } from '@domain/workflow/schemas.js';
import { validateWorkflowGraph } from '@application/workflow/graph-validator.js';
import { broadcast } from './events.js';

// Zod schema for the full playbook payload (for validation during proposal)
const PlaybookPayloadSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  description: z.string().max(2000),
  issueType: z.enum(['epic', 'task']),
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
  issues: WorkflowIssueRepository;
  playbooks: PlaybookRepository;
  agentRoles: AgentRoleRepository;
  topologyLoader: TopologyLoader;
  /** Dispatch coordinator for triggering agent dispatch after workflow approval */
  dispatcher?: DispatchCoordinator;
}

export function createWorkflowProposalRouter(deps: WorkflowProposalRouterDeps): Router {
  const router = Router();
  const { engine, issues, playbooks, agentRoles, topologyLoader, dispatcher } = deps;

  router.post('/workflow/issues/:id/propose-workflow', (req, res) => {
    const issueId = req.params.id as WorkflowIssueId;
    const { epicTemplate: epicPlaybook, taskTemplate: taskPlaybook, agentRoles: proposedRoles, rationale } = req.body;

    const issue = issues.findById(issueId);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    if (issue.type !== 'epic') {
      return res.status(400).json({ error: 'Workflow proposals can only be made for epics' });
    }
    if (!epicPlaybook) return res.status(400).json({ error: 'epicTemplate is required' });
    if (!rationale || typeof rationale !== 'string') {
      return res.status(400).json({ error: 'rationale is required' });
    }

    // Validate epic playbook
    const epicParseResult = PlaybookPayloadSchema.safeParse(epicPlaybook);
    if (!epicParseResult.success) {
      res.status(400).json({
        error: 'Invalid epic playbook',
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

    // Validate task playbook if provided
    let validatedTaskPlaybook = null;
    if (taskPlaybook) {
      const taskParseResult = PlaybookPayloadSchema.safeParse(taskPlaybook);
      if (!taskParseResult.success) {
        res.status(400).json({
          error: 'Invalid task playbook',
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

      validatedTaskPlaybook = taskParseResult.data;
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
    const existingStateData = (issue.stateData || {}) as Record<string, unknown>;
    const workflowProposal = {
      epicTemplate: epicParseResult.data,
      taskTemplate: validatedTaskPlaybook,
      agentRoles: validatedRoles.length > 0 ? validatedRoles : undefined,
      rationale,
      proposedAt: new Date().toISOString(),
    };

    const updated = issues.update(issueId, {
      stateData: { ...existingStateData, workflowProposal },
    });

    if (!updated) {
      res.status(500).json({ error: 'Failed to store workflow proposal' });
      return;
    }

    broadcast('workflow:updated', issueId);
    res.json({
      message: 'Workflow proposal stored. Awaiting human approval.',
      issueId,
      proposal: workflowProposal,
    });
  });

  router.post('/workflow/issues/:id/approve-workflow', async (req, res) => {
    const issueId = req.params.id as WorkflowIssueId;
    const issue = issues.findById(issueId);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    const stateData = (issue.stateData || {}) as Record<string, unknown>;
    const proposal = stateData.workflowProposal as {
      epicTemplate: z.infer<typeof PlaybookPayloadSchema>;
      taskTemplate?: z.infer<typeof PlaybookPayloadSchema>;
      agentRoles?: Array<z.infer<typeof AgentRoleSchema>>;
      rationale: string;
      proposedAt: string;
    } | undefined;

    if (!proposal) {
      return res.status(400).json({ error: 'No pending workflow proposal found on this issue' });
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

      // Resolve epic playbook — reuse existing if the proposed ID is already in the library
      let epicPlaybook = playbooks.findLatest(proposal.epicTemplate.id);
      if (!epicPlaybook) {
        epicPlaybook = playbooks.create({
          id: proposal.epicTemplate.id,
          version: 1,
          name: proposal.epicTemplate.name,
          description: proposal.epicTemplate.description,
          issueType: proposal.epicTemplate.issueType,
          stageDefinitions: proposal.epicTemplate.stageDefinitions,
          promptOverrides: proposal.epicTemplate.promptOverrides,
          tags: proposal.epicTemplate.tags,
          matchCriteria: proposal.epicTemplate.matchCriteria,
          usageCount: 0,
          parentPlaybookId: undefined,
          createdBy: 'workflow-proposal',
        });
      }

      // Resolve task playbook — reuse existing if the proposed ID is already in the library
      let taskPlaybookRow = null;
      if (proposal.taskTemplate) {
        taskPlaybookRow = playbooks.findLatest(proposal.taskTemplate.id);
        if (!taskPlaybookRow) {
          taskPlaybookRow = playbooks.create({
            id: proposal.taskTemplate.id,
            version: 1,
            name: proposal.taskTemplate.name,
            description: proposal.taskTemplate.description,
            issueType: proposal.taskTemplate.issueType,
            stageDefinitions: proposal.taskTemplate.stageDefinitions,
            promptOverrides: proposal.taskTemplate.promptOverrides,
            tags: proposal.taskTemplate.tags,
            matchCriteria: proposal.taskTemplate.matchCriteria,
            usageCount: 0,
            parentPlaybookId: epicPlaybook.id,
            createdBy: 'workflow-proposal',
          });
        }
      }

      // Bind the playbook to the issue
      const updatedStateData = { ...stateData };
      delete updatedStateData.workflowProposal;

      const updated = issues.update(issueId, {
        playbookRowId: epicPlaybook.rowId,
        stateData: updatedStateData,
      });

      if (!updated) {
        res.status(500).json({ error: 'Failed to bind playbook to issue' });
        return;
      }

      // Clear topology cache and increment usage
      topologyLoader.clearCache();
      playbooks.incrementUsage(epicPlaybook.rowId);

      // Move to the playbook's entry state.
      // We set the state directly rather than using engine.transition() because
      // the pre-playbook state (e.g. 'idea') doesn't exist in the playbook's
      // topology, so transition validation would reject it.
      const stages = epicPlaybook.stageDefinitions;
      const entryStage = stages.find(
        (s: Record<string, unknown>) => s.semanticRole === 'entry',
      ) ?? stages[0];
      const entryState = entryStage?.state as string | undefined;

      if (entryState && issue.state !== entryState) {
        issues.update(issueId, {
          state: entryState as WorkflowState,
          stateChangedAt: new Date().toISOString(),
        });
      }

      // Dispatch agents for the entry state
      if (dispatcher) {
        try {
          await dispatcher.dispatchForCurrentState(issueId);
        } catch (dispatchErr) {
          console.error('Failed to dispatch agents after workflow approval:', dispatchErr);
        }
      }

      broadcast('workflow:updated', issueId);
      res.json({
        message: 'Workflow approved and applied',
        issueId,
        epicPlaybookRowId: epicPlaybook.rowId,
        taskPlaybookRowId: taskPlaybookRow?.rowId ?? null,
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
