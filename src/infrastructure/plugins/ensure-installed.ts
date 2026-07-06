import type { PluginSyncResult } from '@foundation/types';
import type { PluginInstaller } from '@domain/plugin/installer';
import type { PluginRepository } from '@domain/plugin/repository';
import { createClaudePluginInstaller } from './claude-plugin-installer.js';
import { createGeminiExtensionInstaller } from './gemini-extension-installer.js';
import { detectCloneProviders, readAgentsRules, syncPluginClone, writeCodexGlobalRules } from './rules-writer.js';

export interface PluginInstallerAdapters {
  claude: PluginInstaller;
  gemini: PluginInstaller;
}

export function createDefaultInstallerAdapters(): PluginInstallerAdapters {
  return {
    claude: createClaudePluginInstaller(),
    gemini: createGeminiExtensionInstaller(),
  };
}

/**
 * Idempotently sync all enabled registered plugins across providers:
 * clone/update repos, detect provider coverage, install via the Claude and
 * Gemini CLIs where supported, and refresh the codex global rules block.
 *
 * Per-plugin errors are isolated and reported in the results — one bad
 * plugin (or a missing CLI, or being offline) never aborts the rest.
 */
export async function ensureRegisteredPluginsInstalled(
  plugins: PluginRepository,
  adapters: PluginInstallerAdapters = createDefaultInstallerAdapters(),
): Promise<PluginSyncResult[]> {
  const results: PluginSyncResult[] = [];
  const enabled = plugins.findAll().filter((p) => p.enabled);

  // 1. Sync clones + detect provider coverage
  for (const plugin of enabled) {
    const cloneResult = await syncPluginClone(plugin.marketplaceRepo);
    results.push({ pluginName: plugin.pluginName, provider: 'clone', ...cloneResult });
    if (cloneResult.success) {
      plugin.providers = detectCloneProviders(plugin.marketplaceRepo);
      plugins.update(plugin.id, { providers: plugin.providers });
    }
  }

  // 2. Claude Code — marketplace add (deduped) + install
  const claudeAvailable = await adapters.claude.isAvailable();
  if (claudeAvailable) {
    const marketplaces = new Set(enabled.filter((p) => p.providers?.claude !== false).map((p) => p.marketplaceRepo));
    const marketplaceResults = new Map<string, boolean>();
    for (const repo of marketplaces) {
      const result = await adapters.claude.ensureMarketplaceAdded(repo);
      marketplaceResults.set(repo, result.success);
      if (!result.success) {
        results.push({ pluginName: repo, provider: 'claude', ...result });
      }
    }
    for (const plugin of enabled) {
      if (plugin.providers?.claude === false) continue;
      if (marketplaceResults.get(plugin.marketplaceRepo) === false) continue;
      const result = await adapters.claude.ensureInstalled(plugin.pluginName, plugin.marketplaceRepo);
      results.push({ pluginName: plugin.pluginName, provider: 'claude', ...result });
    }
  } else {
    results.push({
      pluginName: '*', provider: 'claude', success: false,
      message: 'claude CLI unavailable or lacks plugin support — skipped',
    });
  }

  // 3. Gemini — only for plugins that ship a gemini extension
  const geminiPlugins = enabled.filter((p) => p.providers?.gemini);
  if (geminiPlugins.length > 0) {
    if (await adapters.gemini.isAvailable()) {
      for (const plugin of geminiPlugins) {
        const result = await adapters.gemini.ensureInstalled(plugin.pluginName, plugin.marketplaceRepo);
        results.push({ pluginName: plugin.pluginName, provider: 'gemini', ...result });
      }
    } else {
      results.push({
        pluginName: '*', provider: 'gemini', success: false,
        message: 'gemini CLI unavailable — skipped',
      });
    }
  }

  // 4. Codex — refresh the managed global rules block (also removes it when
  // no enabled plugin ships rules, so disables propagate)
  const rules = readAgentsRules(enabled.filter((p) => p.providers?.codex));
  const codexResult = writeCodexGlobalRules(rules);
  results.push({ pluginName: '*', provider: 'codex-rules', ...codexResult });

  return results;
}
