/**
 * Workflow playbook routes — playbook registry, agent roles, graph validation.
 */
import { Router } from 'express';
import type { PlaybookRepository } from '@domain/workflow/playbook-repository.js';
import type { AgentRoleRepository } from '@domain/workflow/agent-role-repository.js';
import { StageDefinitionsSchema } from '@domain/workflow/schemas.js';
import { validateWorkflowGraph } from '@application/workflow/graph-validator.js';
import { buildSkillChainStages, type ChainStep } from '@application/workflow/skill-chain.js';

function parseSteps(raw: unknown): ChainStep[] | null {
  if (!Array.isArray(raw)) return null;
  const steps: ChainStep[] = [];
  for (const s of raw) {
    if (typeof s !== 'object' || s === null) return null;
    const { prompt, pauseAfter } = s as Record<string, unknown>;
    if (typeof prompt !== 'string' || !prompt.trim()) return null;
    if (pauseAfter !== undefined && typeof pauseAfter !== 'boolean') return null;
    steps.push({ prompt, pauseAfter });
  }
  return steps;
}

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

  // --- Create a skill-chain playbook from an ordered list of prompts ---

  router.post('/workflow/playbooks/chain', (req, res) => {
    const { name, description } = req.body ?? {};
    const steps = parseSteps(req.body?.steps);
    if (typeof name !== 'string' || !name.trim() || name.length > 128) {
      res.status(400).json({ error: 'name is required (max 128 characters)' });
      return;
    }
    if (description !== undefined && typeof description !== 'string') {
      res.status(400).json({ error: 'description must be a string' });
      return;
    }
    if (!steps) {
      res.status(400).json({ error: 'steps must be an array of { prompt, pauseAfter? } with non-blank prompts' });
      return;
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug) {
      res.status(400).json({ error: 'name must contain letters or digits' });
      return;
    }
    const id = `chain-${slug}`;
    if (playbooks.findLatest(id)) {
      res.status(409).json({ error: `A workflow named "${id}" already exists` });
      return;
    }

    let stages;
    try {
      stages = buildSkillChainStages(steps);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid steps' });
      return;
    }
    const parsed = StageDefinitionsSchema.safeParse(stages);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ') });
      return;
    }
    const graph = validateWorkflowGraph(parsed.data);
    if (!graph.valid) {
      res.status(400).json({ error: 'Invalid workflow graph', errors: graph.errors });
      return;
    }

    const created = playbooks.create({
      id,
      version: 1,
      name: name.trim(),
      description: description?.trim() ?? '',
      issueType: 'epic',
      stageDefinitions: parsed.data,
      tags: ['skill-chain'],
      usageCount: 0,
      createdBy: 'workflow-builder',
    });
    res.status(201).json(created);
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
