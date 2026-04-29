import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import type { AgentId } from '@foundation/types';
import type { AgentRepository } from '@domain/agent/repository';
import type { FilesystemAgentScanner } from '@infrastructure/agents/filesystem-scanner.js';
import {
  writeGlobalAgent,
  updateGlobalAgent,
  deleteGlobalAgent,
} from '@infrastructure/agents/filesystem-scanner.js';
import { callClaude, extractJson, ClaudeBinaryNotFoundError } from './claude-cli.js';

export interface AgentRouterDeps {
  agents: AgentRepository;
  filesystemScanner: FilesystemAgentScanner;
  projectRoot: string;
}

/** Translate a callClaude error into an HTTP response. See note in
 *  skill-routes.ts — surfaces the actual error so the UI can distinguish
 *  "claude binary not on the server's PATH" from real CLI failures. */
function respondWithClaudeError(res: import('express').Response, err: unknown, fallback: string): void {
  if (err instanceof ClaudeBinaryNotFoundError) {
    res.status(503).json({ error: err.message, code: 'claude_not_found' });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: `${fallback}: ${message}` });
}

export function createAgentRouter(deps: AgentRouterDeps): Router {
  const router = Router();
  const { agents, filesystemScanner, projectRoot } = deps;

  // --- Agent templates (templates/agents/*.md not yet installed) ---

  router.get('/agents/templates', (_req, res) => {
    const tplDir = path.join(projectRoot, 'templates', 'agents');
    if (!fs.existsSync(tplDir)) { res.json([]); return; }
    const installed = new Set([
      ...filesystemScanner.scanAll(projectRoot).map((a) => a.name),
      ...agents.findAll().map((a) => a.name),
    ]);
    const templates: unknown[] = [];
    for (const file of fs.readdirSync(tplDir).filter((f) => f.endsWith('.md'))) {
      try {
        const raw = fs.readFileSync(path.join(tplDir, file), 'utf-8');
        const nameMatch = raw.match(/^name:\s*(.+)$/m);
        const descMatch = raw.match(/^description:\s*(.+)$/m);
        const name = nameMatch?.[1]?.trim() ?? path.basename(file, '.md');
        if (installed.has(name)) continue;
        const slug = path.basename(file, '.md');
        templates.push({ name, description: descMatch?.[1]?.trim() ?? '', slug, raw });
      } catch { /* skip */ }
    }
    res.json(templates);
  });

  // --- Save current agent as template ---

  router.post('/agents/:id/save-as-template', (req, res) => {
    const id = req.params.id as AgentId;
    const agent = filesystemScanner.findById(id, projectRoot) ?? agents.findById(id);
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

    const tplDir = path.join(projectRoot, 'templates', 'agents');
    fs.mkdirSync(tplDir, { recursive: true });
    const slug = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const tplLines = ['---', `name: ${agent.name}`, `description: ${agent.description}`];
    if (agent.model) tplLines.push(`model: ${agent.model}`);
    if (agent.color) tplLines.push(`color: ${agent.color}`);
    if (agent.allowedTools?.length) tplLines.push(`tools: ${agent.allowedTools.join(', ')}`);
    if (agent.maxTurns) tplLines.push(`maxTurns: ${agent.maxTurns}`);
    tplLines.push('---', '', agent.systemPrompt);
    fs.writeFileSync(path.join(tplDir, `${slug}.md`), tplLines.join('\n'), 'utf-8');

    // Persist templateName into the agent file
    if (id.startsWith('global:')) {
      const updated = updateGlobalAgent(id, { ...agent, templateName: slug });
      res.json(updated);
    } else {
      res.json({ ...agent, templateName: slug });
    }
  });

  // --- Sync agent from its linked template ---

  router.post('/agents/:id/sync-from-template', (req, res) => {
    const id = req.params.id as AgentId;
    const agent = filesystemScanner.findById(id, projectRoot) ?? agents.findById(id);
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
    if (!agent.templateName) { res.status(400).json({ error: 'Agent has no linked template' }); return; }

    const tplPath = path.join(projectRoot, 'templates', 'agents', `${agent.templateName}.md`);
    if (!fs.existsSync(tplPath)) { res.status(404).json({ error: 'Template file not found' }); return; }

    const raw = fs.readFileSync(tplPath, 'utf-8');
    const bodyStart = raw.indexOf('\n---\n', raw.indexOf('---') + 3);
    const systemPrompt = bodyStart >= 0 ? raw.slice(bodyStart + 5).trim() : raw;
    const descMatch = raw.match(/^description:\s*(.+)$/m);
    const description = descMatch?.[1]?.trim() ?? agent.description;

    if (id.startsWith('global:')) {
      const updated = updateGlobalAgent(id, { ...agent, systemPrompt, description });
      res.json(updated);
    } else {
      res.json({ ...agent, systemPrompt, description });
    }
  });

  // --- Install template agent (add to ~/.claude/agents/) ---

  router.post('/agents/install-template', (req, res) => {
    const { slug, raw } = req.body as { slug: string; raw: string };
    if (!slug || !raw) { res.status(400).json({ error: 'slug and raw are required' }); return; }
    try {
      const nameMatch = raw.match(/^name:\s*(.+)$/m);
      const descMatch = raw.match(/^description:\s*(.+)$/m);
      const modelMatch = raw.match(/^model:\s*(.+)$/m);
      const colorMatch = raw.match(/^color:\s*(.+)$/m);
      const toolsMatch = raw.match(/^tools:\s*(.+)$/m);
      const bodyStart = raw.indexOf('\n---\n', raw.indexOf('---') + 3);
      const systemPrompt = bodyStart >= 0 ? raw.slice(bodyStart + 5).trim() : raw;
      const name = nameMatch?.[1]?.trim() ?? slug;
      const agent = writeGlobalAgent({
        name,
        description: descMatch?.[1]?.trim() ?? '',
        model: modelMatch?.[1]?.trim(),
        color: colorMatch?.[1]?.trim(),
        systemPrompt,
        allowedTools: toolsMatch?.[1]?.split(',').map((t) => t.trim()).filter(Boolean),
        templateName: slug,
      });
      res.status(201).json(agent);
    } catch (err) {
      res.status(500).json({ error: 'Failed to install template agent' });
    }
  });

  // --- Get all agents (with isOutOfSync enrichment) ---

  router.get('/agents', (_req, res) => {
    const tplDir = path.join(projectRoot, 'templates', 'agents');
    const all = [...filesystemScanner.scanAll(projectRoot), ...agents.findAll()];
    const enriched = all.map((agent) => {
      if (!agent.templateName) return agent;
      const tplPath = path.join(tplDir, `${agent.templateName}.md`);
      try {
        const raw = fs.readFileSync(tplPath, 'utf-8');
        const bodyStart = raw.indexOf('\n---\n', raw.indexOf('---') + 3);
        const tplPrompt = bodyStart >= 0 ? raw.slice(bodyStart + 5).trim() : raw;
        const isOutOfSync = agent.systemPrompt !== tplPrompt;
        return isOutOfSync ? { ...agent, isOutOfSync: true, templateContent: tplPrompt } : agent;
      } catch {
        return agent;
      }
    });
    res.json(enriched);
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
      respondWithClaudeError(res, err, 'Agent generation failed');
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
      respondWithClaudeError(res, err, 'Agent improvement failed');
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
