import { Router } from 'express';
import type { PluginId } from '@foundation/types';
import type { PluginRepository } from '@domain/plugin/repository';
import { ensureRegisteredPluginsInstalled } from '@infrastructure/plugins/ensure-installed.js';
import { broadcast } from './events.js';

export interface PluginRouterDeps {
  plugins: PluginRepository;
}

/** Valid 'owner/repo' GitHub shorthand */
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

export function createPluginRouter(deps: PluginRouterDeps): Router {
  const router = Router();
  const { plugins } = deps;

  /** Kick off a sync without blocking the response — errors are logged only */
  function syncInBackground(): void {
    ensureRegisteredPluginsInstalled(plugins)
      .then(() => broadcast('plugin:updated', 'sync'))
      .catch((err) => console.error('[plugins] Background sync failed:', err));
  }

  // --- Sync all enabled plugins across providers (must be before :id route) ---

  router.post('/plugins/sync', async (_req, res) => {
    try {
      const results = await ensureRegisteredPluginsInstalled(plugins);
      broadcast('plugin:updated', 'sync');
      res.json({ results });
    } catch (err) {
      console.error('[plugins] Sync failed:', err);
      res.status(500).json({ error: 'Plugin sync failed' });
    }
  });

  // --- List all registered plugins ---

  router.get('/plugins', (_req, res) => {
    res.json(plugins.findAll());
  });

  // --- Register a plugin ---

  router.post('/plugins', (req, res) => {
    const { marketplaceRepo, pluginName, description, enabled } = req.body;
    if (!marketplaceRepo || !pluginName) {
      res.status(400).json({ error: 'marketplaceRepo and pluginName are required' });
      return;
    }
    if (!REPO_PATTERN.test(marketplaceRepo)) {
      res.status(400).json({ error: 'marketplaceRepo must be an owner/repo GitHub shorthand' });
      return;
    }
    if (plugins.findByName(pluginName)) {
      res.status(409).json({ error: `Plugin ${pluginName} is already registered` });
      return;
    }
    const plugin = plugins.create({ marketplaceRepo, pluginName, description, enabled });
    broadcast('plugin:updated', plugin.id);
    // Make the new plugin available without waiting for the next server start
    syncInBackground();
    res.status(201).json(plugin);
  });

  // --- Update (description / enabled toggle) ---

  router.patch('/plugins/:id', (req, res) => {
    const id = req.params.id as PluginId;
    const { description, enabled } = req.body;
    const updated = plugins.update(id, { description, enabled });
    if (!updated) {
      res.status(404).json({ error: 'Plugin not found' });
      return;
    }
    broadcast('plugin:updated', id);
    // Enable/disable propagates to codex/gemini artifacts at sync time
    if (enabled !== undefined) syncInBackground();
    res.json(updated);
  });

  // --- Delete ---

  router.delete('/plugins/:id', (req, res) => {
    const id = req.params.id as PluginId;
    const deleted = plugins.delete(id);
    if (!deleted) {
      res.status(404).json({ error: 'Plugin not found' });
      return;
    }
    broadcast('plugin:updated', id);
    syncInBackground();
    res.status(204).send();
  });

  return router;
}
