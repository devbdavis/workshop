import { Router } from 'express';
import { spawn } from 'child_process';
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

/**
 * Call the local `claude` CLI in print mode.
 * Uses the user's existing auth — no ANTHROPIC_API_KEY needed.
 */
function callClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', prompt]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Claude CLI timed out after 120s'));
    }, 120_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(Buffer.concat(err).toString().trim() || `claude exited with code ${code}`));
      } else {
        resolve(Buffer.concat(out).toString());
      }
    });

    child.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in Claude response');
  return JSON.parse(match[0]);
}

export function createAgentRouter(deps: AgentRouterDeps): Router {
  const router = Router();
  const { agents, filesystemScanner, projectRoot } = deps;

  // --- Get all agents ---

  router.get('/agents', (_req, res) => {
    res.json([...filesystemScanner.scanAll(projectRoot), ...agents.findAll()]);
  });

  // --- Get single agent ---

  router.get('/agents/:id', (req, res) => {
    const id = req.params.id as AgentId;
    const agent = agents.findById(id) ?? filesystemScanner.findById(id, projectRoot);
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json(agent);
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

  // --- Generate agent definition via claude CLI ---

  router.post('/agents/generate', async (req, res) => {
    const { description } = req.body;
    if (!description || typeof description !== 'string') {
      res.status(400).json({ error: 'description is required' });
      return;
    }

    const prompt = `Generate a Claude Code agent definition based on this description:\n\n${description}\n\nReturn a JSON object with these fields:\n- name: short agent name (2-4 words, Title Case)\n- description: one sentence describing what this agent does\n- systemPrompt: detailed system prompt (thorough, specific to the role)\n- model: optional model ID, leave empty unless clearly needed\n- color: optional CSS color name fitting the agent purpose\n- allowedTools: optional array of Claude Code tool names (Read, Edit, Write, Bash, Glob, Grep, WebSearch, WebFetch, Agent)\n\nReturn ONLY the JSON object, no other text or markdown.`;

    try {
      const output = await callClaude(prompt);
      res.json(extractJson(output));
    } catch (err) {
      console.error('Agent generation failed:', err);
      res.status(500).json({ error: 'Agent generation failed' });
    }
  });

  // --- Create agent (writes to ~/.claude/agents/) ---

  router.post('/agents', (req, res) => {
    const { name, description, model, color, systemPrompt, allowedTools, maxTurns, provider } = req.body;

    if (!name || typeof name !== 'string') { res.status(400).json({ error: 'name is required' }); return; }
    if (!description || typeof description !== 'string') { res.status(400).json({ error: 'description is required' }); return; }
    if (!systemPrompt || typeof systemPrompt !== 'string') { res.status(400).json({ error: 'systemPrompt is required' }); return; }

    try {
      res.status(201).json(writeGlobalAgent({ name, description, model, color, systemPrompt, allowedTools, maxTurns, provider }));
    } catch (err) {
      console.error('Failed to write agent file:', err);
      res.status(500).json({ error: 'Failed to create agent' });
    }
  });

  // --- Update agent ---

  router.put('/agents/:id', (req, res) => {
    const id = req.params.id as AgentId;
    const data = req.body;

    if (id.startsWith('project:')) { res.status(403).json({ error: 'Cannot modify project agents' }); return; }

    if (id.startsWith('global:')) {
      const updated = updateGlobalAgent(id, data);
      if (!updated) { res.status(404).json({ error: 'Agent not found' }); return; }
      res.json(updated);
      return;
    }

    const updated = agents.update(id, data);
    if (!updated) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.json(updated);
  });

  // --- Improve agent with Claude feedback ---

  router.post('/agents/:id/improve', async (req, res) => {
    const id = req.params.id as AgentId;
    const { feedback } = req.body;
    if (!feedback || typeof feedback !== 'string') { res.status(400).json({ error: 'feedback is required' }); return; }

    const agent = filesystemScanner.findById(id, projectRoot) ?? agents.findById(id);
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

    const prompt = `You are improving a Claude Code agent definition based on user feedback.

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

Return ONLY the JSON object, no other text or markdown.`;

    try {
      const output = await callClaude(prompt);
      res.json(extractJson(output));
    } catch (err) {
      console.error('Agent improvement failed:', err);
      res.status(500).json({ error: 'Agent improvement failed' });
    }
  });

  // --- Delete agent ---

  router.delete('/agents/:id', (req, res) => {
    const id = req.params.id as AgentId;

    if (id.startsWith('project:')) { res.status(403).json({ error: 'Cannot delete project agents' }); return; }

    if (id.startsWith('global:')) {
      if (!deleteGlobalAgent(id)) { res.status(404).json({ error: 'Agent not found' }); return; }
      res.status(204).send();
      return;
    }

    if (!agents.delete(id)) { res.status(404).json({ error: 'Agent not found' }); return; }
    res.status(204).send();
  });

  return router;
}
