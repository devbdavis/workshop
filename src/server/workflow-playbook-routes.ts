/**
 * Workflow playbook routes — playbook registry, agent roles, graph validation.
 */
import { Router } from 'express';
import type { PlaybookRepository } from '@domain/workflow/playbook-repository.js';
import type { AgentRoleRepository } from '@domain/workflow/agent-role-repository.js';
import { StageDefinitionsSchema } from '@domain/workflow/schemas.js';
import { validateWorkflowGraph } from '@application/workflow/graph-validator.js';

export interface PlaybookRouterDeps {
  playbooks: PlaybookRepository;
  agentRoles: AgentRoleRepository;
}

export function createPlaybookRouter(deps: PlaybookRouterDeps): Router {
  const router = Router();
  const { playbooks, agentRoles } = deps;

  // --- List all latest playbooks ---

  router.get('/workflow/playbooks', (req, res) => {
    const { issueType, tags } = req.query;
    const filters: { issueType?: string; tags?: string[] } = {};

    if (issueType && typeof issueType === 'string') {
      filters.issueType = issueType;
    }
    if (tags && typeof tags === 'string') {
      filters.tags = tags.split(',').map((t) => t.trim());
    }

    const result = playbooks.findAllLatest(filters);
    res.json(result);
  });

  // --- Get single playbook by rowId ---

  router.get('/workflow/playbooks/:rowId', (req, res) => {
    const playbook = playbooks.findByRowId(req.params.rowId);
    if (!playbook) {
      res.status(404).json({ error: 'Playbook not found' });
      return;
    }
    res.json(playbook);
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
