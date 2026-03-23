/**
 * Workflow template routes — template registry, agent roles, graph validation.
 */
import { Router } from 'express';
import type { WorkflowTemplateRepository } from '@domain/workflow/template-repository.js';
import type { AgentRoleRepository } from '@domain/workflow/agent-role-repository.js';
import { StageDefinitionsSchema } from '@domain/workflow/schemas.js';
import { validateWorkflowGraph } from '@application/workflow/graph-validator.js';

export interface WorkflowTemplateRouterDeps {
  templates: WorkflowTemplateRepository;
  agentRoles: AgentRoleRepository;
}

export function createWorkflowTemplateRouter(deps: WorkflowTemplateRouterDeps): Router {
  const router = Router();
  const { templates, agentRoles } = deps;

  // --- List all latest templates ---

  router.get('/workflow/templates', (req, res) => {
    const { ticketType, tags } = req.query;
    const filters: { ticketType?: string; tags?: string[] } = {};

    if (ticketType && typeof ticketType === 'string') {
      filters.ticketType = ticketType;
    }
    if (tags && typeof tags === 'string') {
      filters.tags = tags.split(',').map((t) => t.trim());
    }

    const result = templates.findAllLatest(filters);
    res.json(result);
  });

  // --- Get single template by rowId ---

  router.get('/workflow/templates/:rowId', (req, res) => {
    const template = templates.findByRowId(req.params.rowId);
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.json(template);
  });

  // --- List all agent roles ---

  router.get('/workflow/agent-roles', (req, res) => {
    const { capabilityTier, reusable } = req.query;
    const filters: { capabilityTier?: string; reusable?: boolean } = {};

    if (capabilityTier && typeof capabilityTier === 'string') {
      filters.capabilityTier = capabilityTier;
    }
    if (reusable !== undefined) {
      filters.reusable = reusable === 'true';
    }

    const result = agentRoles.findAll(filters);
    res.json(result);
  });

  // --- Validate a workflow graph ---

  router.post('/workflow/validate-graph', (req, res) => {
    const { stageDefinitions } = req.body;

    if (!stageDefinitions || !Array.isArray(stageDefinitions)) {
      res.status(400).json({ error: 'stageDefinitions array is required' });
      return;
    }

    // Parse through Zod first
    const parseResult = StageDefinitionsSchema.safeParse(stageDefinitions);
    if (!parseResult.success) {
      res.json({
        valid: false,
        parseErrors: parseResult.error.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
        errors: [],
        warnings: [],
      });
      return;
    }

    // Run graph validation
    const validationResult = validateWorkflowGraph(parseResult.data);
    res.json(validationResult);
  });

  return router;
}
