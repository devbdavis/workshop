import { Router } from 'express';
import type { McpServerConfigId, McpTransportType, McpInstallResult } from '@foundation/types';
import type { McpServerConfigRepository } from '@domain/mcp-config/repository';
import type { McpToolAdapter, CliTool } from '@infrastructure/mcp-tools/types.js';
import { broadcast } from './events.js';

export interface McpConfigRouterDeps {
  mcpConfigs: McpServerConfigRepository;
  adapters: Record<CliTool, McpToolAdapter>;
}

export function createMcpConfigRouter(deps: McpConfigRouterDeps): Router {
  const router = Router();
  const { mcpConfigs, adapters } = deps;

  // --- Check which CLI tools are available (must be before :id route) ---

  router.get('/mcp-configs/tool-status', async (_req, res) => {
    const [claude, codex, gemini] = await Promise.all([
      adapters.claude.isAvailable(),
      adapters.codex.isAvailable(),
      adapters.gemini.isAvailable(),
    ]);
    res.json({ claude, codex, gemini });
  });

  // --- List all stored MCP configs ---

  router.get('/mcp-configs', (_req, res) => {
    res.json(mcpConfigs.findAll());
  });

  // --- Get single config ---

  router.get('/mcp-configs/:id', (req, res) => {
    const config = mcpConfigs.findById(req.params.id as McpServerConfigId);
    if (!config) {
      res.status(404).json({ error: 'MCP config not found' });
      return;
    }
    res.json(config);
  });

  // --- Create config manually ---

  router.post('/mcp-configs', (req, res) => {
    const { name, transportType, command, args, env, url, headers } = req.body;
    if (!name || !transportType) {
      res.status(400).json({ error: 'name and transportType are required' });
      return;
    }
    const config = mcpConfigs.create({
      name,
      transportType: transportType as McpTransportType,
      command, args, env, url, headers,
      enabled: true,
      source: 'manual',
    });
    broadcast('mcp-config:updated', config.id);
    res.status(201).json(config);
  });

  // --- Update config ---

  router.put('/mcp-configs/:id', (req, res) => {
    const id = req.params.id as McpServerConfigId;
    const updated = mcpConfigs.update(id, req.body);
    if (!updated) {
      res.status(404).json({ error: 'MCP config not found' });
      return;
    }
    broadcast('mcp-config:updated', id);
    res.json(updated);
  });

  // --- Delete config ---

  router.delete('/mcp-configs/:id', (req, res) => {
    const id = req.params.id as McpServerConfigId;
    const deleted = mcpConfigs.delete(id);
    if (!deleted) {
      res.status(404).json({ error: 'MCP config not found' });
      return;
    }
    broadcast('mcp-config:updated', id);
    res.status(204).send();
  });

  // --- Import from Claude Code ---

  router.post('/mcp-configs/import-from-claude', async (_req, res) => {
    try {
      const claude = adapters.claude;
      if (!(await claude.isAvailable())) {
        res.status(400).json({ error: 'Claude CLI is not available' });
        return;
      }

      const servers = await claude.listServers();
      const imported: string[] = [];

      for (const server of servers) {
        if (!server.name || !server.transportType) continue;
        mcpConfigs.upsertByName({
          name: server.name,
          transportType: server.transportType,
          command: server.command,
          args: server.args,
          env: server.env,
          url: server.url,
          headers: server.headers,
          enabled: true,
          source: 'claude-import',
        });
        imported.push(server.name);
      }

      broadcast('mcp-config:updated', 'bulk');
      res.json({ imported, count: imported.length });
    } catch (err) {
      console.error('Failed to import from Claude:', err);
      res.status(500).json({ error: 'Failed to import from Claude CLI' });
    }
  });

  // --- Install single config to tools ---

  router.post('/mcp-configs/:id/install', async (req, res) => {
    const config = mcpConfigs.findById(req.params.id as McpServerConfigId);
    if (!config) {
      res.status(404).json({ error: 'MCP config not found' });
      return;
    }

    const tools = (req.body.tools || ['claude', 'codex', 'gemini']) as CliTool[];
    const results = await installToTools(config, tools);
    res.json(results);
  });

  // --- Install all enabled configs to tools ---

  router.post('/mcp-configs/install-all', async (req, res) => {
    const tools = (req.body.tools || ['claude', 'codex', 'gemini']) as CliTool[];
    const configs = mcpConfigs.findAll().filter((c) => c.enabled);
    const results: McpInstallResult[] = [];

    for (const config of configs) {
      const r = await installToTools(config, tools);
      results.push(...r);
    }

    res.json({ results, configCount: configs.length });
  });

  async function installToTools(
    config: import('@foundation/types').McpServerConfig,
    tools: CliTool[],
  ): Promise<McpInstallResult[]> {
    const results: McpInstallResult[] = [];
    for (const tool of tools) {
      const adapter = adapters[tool];
      if (!(await adapter.isAvailable())) {
        results.push({ tool, serverName: config.name, success: false, message: `${tool} CLI not available` });
        continue;
      }
      const result = await adapter.installServer(config);
      results.push(result);
    }
    return results;
  }

  return router;
}
