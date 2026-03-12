import { Router } from 'express';
import type { AgentId } from '@foundation/types';
import type { AgentRepository } from '@domain/agent/repository';
import type { FilesystemAgentScanner } from '@infrastructure/agents/filesystem-scanner.js';

export interface AgentRouterDeps {
  agents: AgentRepository;
  filesystemScanner: FilesystemAgentScanner;
  projectRoot: string;
}

export function createAgentRouter(deps: AgentRouterDeps): Router {
  const router = Router();
  const { agents, filesystemScanner, projectRoot } = deps;

  // Helper to check if ID is a filesystem agent (global: or project: prefix)
  function isFilesystemAgent(id: string): boolean {
    return id.startsWith('global:') || id.startsWith('project:');
  }

  // --- Get all agents (merged: filesystem + DB) ---

  router.get('/agents', (_req, res) => {
    const dbAgents = agents.findAll();
    const fsAgents = filesystemScanner.scanAll(projectRoot);
    res.json([...fsAgents, ...dbAgents]);
  });

  // --- Get single agent ---

  router.get('/agents/:id', (req, res) => {
    const id = req.params.id as AgentId;

    // Check DB first (workshop agents)
    const dbAgent = agents.findById(id);
    if (dbAgent) {
      res.json(dbAgent);
      return;
    }

    // Then check filesystem agents
    const fsAgent = filesystemScanner.findById(id, projectRoot);
    if (fsAgent) {
      res.json(fsAgent);
      return;
    }

    res.status(404).json({ error: 'Agent not found' });
  });

  // --- Create workshop agent ---

  router.post('/agents', (req, res) => {
    const { name, description, model, color, systemPrompt, allowedTools, maxTurns } = req.body;

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!description || typeof description !== 'string') {
      res.status(400).json({ error: 'description is required' });
      return;
    }
    if (!systemPrompt || typeof systemPrompt !== 'string') {
      res.status(400).json({ error: 'systemPrompt is required' });
      return;
    }

    const agent = agents.create({
      name,
      description,
      model,
      color,
      systemPrompt,
      allowedTools,
      maxTurns,
    });
    res.status(201).json(agent);
  });

  // --- Update workshop agent (403 for filesystem agents) ---

  router.put('/agents/:id', (req, res) => {
    const id = req.params.id as AgentId;

    if (isFilesystemAgent(id)) {
      res.status(403).json({ error: 'Cannot modify filesystem agents' });
      return;
    }

    const { name, description, model, color, systemPrompt, allowedTools, maxTurns } = req.body;
    const updated = agents.update(id, {
      name,
      description,
      model,
      color,
      systemPrompt,
      allowedTools,
      maxTurns,
    });

    if (!updated) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    res.json(updated);
  });

  // --- Delete workshop agent (403 for filesystem agents) ---

  router.delete('/agents/:id', (req, res) => {
    const id = req.params.id as AgentId;

    if (isFilesystemAgent(id)) {
      res.status(403).json({ error: 'Cannot delete filesystem agents' });
      return;
    }

    const deleted = agents.delete(id);
    if (!deleted) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    res.status(204).send();
  });

  return router;
}
