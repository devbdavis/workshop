import type { Plugin, PluginId, PluginProviders } from '@foundation/types';

export interface PluginRepository {
  findAll(): Plugin[];
  findById(id: PluginId): Plugin | null;
  findByName(pluginName: string): Plugin | null;
  create(data: Pick<Plugin, 'marketplaceRepo' | 'pluginName'> & Partial<Pick<Plugin, 'description' | 'enabled'>>): Plugin;
  update(id: PluginId, data: Partial<Pick<Plugin, 'description' | 'enabled' | 'providers'>>): Plugin | null;
  delete(id: PluginId): boolean;
}

/**
 * Map every registered plugin to an explicit enabled flag for Claude Code's
 * per-session settings `enabledPlugins` key. Disabled registry entries are
 * written as explicit `false` so a workshop-level disable overrides the
 * user-global install for Workshop-spawned sessions.
 */
export function toEnabledPluginsMap(plugins: Plugin[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const plugin of plugins) {
    map[plugin.pluginName] = plugin.enabled;
  }
  return map;
}

/** Detect provider coverage from files present in a plugin repo checkout */
export function detectProviders(files: { hasClaudePlugin: boolean; hasGeminiExtension: boolean; hasAgentsMd: boolean }): PluginProviders {
  return {
    claude: files.hasClaudePlugin,
    gemini: files.hasGeminiExtension,
    codex: files.hasAgentsMd,
    cursor: files.hasAgentsMd,
  };
}
