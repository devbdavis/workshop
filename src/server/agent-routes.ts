import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import type { AgentId } from '@foundation/types';
import type { AgentRepository } from '@domain/agent/repository';
import type { FilesystemAgentScanner } from '@infrastructure/agents/filesystem-scanner.js';
import {
  writeGlobalAgent,
  updateGlobalAgent,
  deleteGlobalAgent,
} from '@infrastructure/agents/filesystem-scanner.js';

export interface AgentRouterDeps {
  agents: AgentRepository;
  filesystemScanner: FilesystemAgentScanner;
  projectRoot: string;
}

export function createAgentRouter(deps: AgentRouterDeps): Router {
  const router = Router();
  const { agents, filesystemScanner, projectRoot } = deps;

  function isFilesystemAgent(id: string): boolean {
    return id.startsWith('global:') || id.startsWith('project:');
  }

  // --- Get all agents (filesystem only — workshop DB agents are legacy) ---

  router.get('/agents', (_req, res) => {
    const dbAgents = agents.findAll();
    const fsAgents = filesystemScanner.scanAll(projectRoot);
    res.json([...fsAgents, ...dbAgents]);
  });

  // --- Get single agent ---

  router.get('/agents/:id', (req, res) => {
    const id = req.params.id as AgentId;

    const dbAgent = agents.findById(id);
    if (dbAgent) { res.json(dbAgent); return; }

    const fsAgent = filesystemScanner.findById(id, projectRoot);
    if (fsAgent) { res.json(fsAgent); return; }

    res.status(404).json({ error: 'Agent not found' });
  });

  // --- Migrate workshop (DB) agents to global filesystem ---

  router.post('/agents/migrate-workshop', (req, res) => {
    const workshopAgents = agents.findAll();
    let migrated = 0;
    for (const agent of workshopAgents) {
      try {
        writeGlobalAgent({
          name: agent.name,
          description: agent.description,
          model: agent.model,
          color: agent.color,
          systemPrompt: agent.systemPrompt,
          allowedTools: agent.allowedTools,
          maxTurns: agent.maxTurns,
          provider: agent.provider,
        });
        agents.delete(agent.id);
        migrated++;
      } catch (err) {
        console.error(`Failed to migrate agent ${agent.id}:`, err);
      }
    }
    res.json({ migrated });
  });

  // --- Generate agent definition via Claude ---

  router.post('/agents/generate', async (req, res) => {
    const { description } = req.body;
    if (!description || typeof description !== 'string') {
      res.status(400).json({ error: 'description is required' });
      return;
    }

    try {
      const client = new Anthropic();
      const message = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: `Generate a Claude Code agent definition based on this description:\n\n${description}\n\nReturn a JSON object with these fields:\n- name: short agent name (2-4 words, Title Case)\n- description: one sentence describing what this agent does\n- systemPrompt: detailed system prompt (thorough, specific to the role)\n- model: optional model ID, leave empty unless clearly needed\n- color: optional CSS color name fitting the agent's purpose\n- allowedTools: optional array of Claude Code tool names (Read, Edit, Write, Bash, Glob, Grep, WebSearch, WebFetch, Agent)\n\nReturn ONLY the JSON object, no other text or markdown.`,
        }],
      });

      const content = message.content[0];
      if (content.type !== 'text') {
        res.status(500).json({ error: 'Unexpected response from Claude' });
        return;
      }

      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        res.status(500).json({ error: 'Could not parse agent definition from Claude response' });
        return;
      }

      res.json(JSON.parse(jsonMatch[0]));
    } catch (err) {
      console.error('Agent generation failed:', err);
      res.status(500).json({ error: 'Agent generation failed' });
    }
  });

  // --- Create agent (writes to ~/.claude/agents/) ---

  router.post('/agents', (req, res) => {
    const { name, description, model, color, systemPrompt, allowedTools, maxTurns, provider } = req.body;

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

    try {
      const agent = writeGlobalAgent({ name, description, model, color, systemPrompt, allowedTools, maxTurns, provider });
      res.status(201).json(agent);
    } catch (err) {
      console.error('Failed to write agent file:', err);
      res.status(500).json({ error: 'Failed to create agent' });
    }
  });

  // --- Update agent (global: filesystem, workshop: DB, project: read-only) ---

  router.put('/agents/:id', (req, res) => {
    const id = req.params.id as AgentId;
    const { name, description, model, color, systemPrompt, allowedTools, maxTurns, provider } = req.body;

    if (id.startsWith('project:')) {
      res.status(403).json({ error: 'Cannot modify project agents' });
      return;
    }

    if (id.startsWith('global:')) {
      const updated = updateGlobalAgent(id, { name, description, model, color, systemPrompt, allowedTools, maxTurns, provider });
      if (!updated) { res.status(404).json({ error: 'Agent not found' }); return; }
      res.json(updated);
      return;
    }

    // Legacy workshop DB agents
    const updated = agents.update(id, { name, description, model, color, systemPrompt, allowedTools, maxTurns, provider });
    if (!updated) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json(updated);
  });

  // --- Improve agent with Claude feedback ---

  router.post('/agents/:id/improve', async (req, res) => {
    const id = req.params.id as AgentId;
    const { feedback } = req.body;
    if (!feedback || typeof feedback !== 'string') {
      res.status(400).json({ error: 'feedback is required' });
      return;
    }

    // Resolve the agent from filesystem or DB
    const agent = filesystemScanner.findById(id, projectRoot) ?? agents.findById(id);
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

    try {
      const client = new Anthropic();
      const message = await client.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: `You are improving a Claude Code agent definition based on user feedback.

Current agent:
Name: ${agent.name}
Description: ${agent.description}
System Prompt:
${agent.systemPrompt}

User feedback:
${feedback}

Return a JSON object with these fields (only include fields that should change):
- name: updated name if needed
- description: updated description if needed
- systemPrompt: the improved system prompt (always include this)
- allowedTools: updated tools array if needed

Return ONLY the JSON object, no other text or markdown.`,
        }],
      });

      const content = message.content[0];
      if (content.type !== 'text') { res.status(500).json({ error: 'Unexpected response' }); return; }
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) { res.status(500).json({ error: 'Could not parse response' }); return; }
      res.json(JSON.parse(jsonMatch[0]));
    } catch (err) {
      console.error('Agent improvement failed:', err);
      res.status(500).json({ error: 'Agent improvement failed' });
    }
  });

  // --- Delete agent (global: filesystem, workshop: DB, project: read-only) ---

  router.delete('/agents/:id', (req, res) => {
    const id = req.params.id as AgentId;

    if (id.startsWith('project:')) {
      res.status(403).json({ error: 'Cannot delete project agents' });
      return;
    }

    if (id.startsWith('global:')) {
      const deleted = deleteGlobalAgent(id);
      if (!deleted) { res.status(404).json({ error: 'Agent not found' }); return; }
      res.status(204).send();
      return;
    }

    // Legacy workshop DB agents
    const deleted = agents.delete(id);
    if (!deleted) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.status(204).send();
  });

  return router;
}
