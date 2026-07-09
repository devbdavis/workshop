import { execFile } from 'child_process';
import { promisify } from 'util';
import type { InstallStepResult, PluginInstaller } from '@domain/plugin/installer';

const execFileAsync = promisify(execFile);

/**
 * Claude Code plugin installer — wraps the headless `claude plugin` CLI.
 *
 * Installs are user-global (state in ~/.claude/plugins/); Workshop layers
 * per-session enablement on top via the --settings enabledPlugins map.
 * All methods fail soft: errors are reported in the result, never thrown.
 */
export function createClaudePluginInstaller(): PluginInstaller {
  return {
    async isAvailable(): Promise<boolean> {
      try {
        // Plugin subcommands are version-gated — verify support, not just the binary
        await execFileAsync('claude', ['plugin', '--help'], { timeout: 15_000 });
        return true;
      } catch {
        return false;
      }
    },

    async ensureMarketplaceAdded(marketplaceRepo: string): Promise<InstallStepResult> {
      try {
        await execFileAsync('claude', ['plugin', 'marketplace', 'add', marketplaceRepo], {
          timeout: 60_000,
        });
        return { success: true, message: `Marketplace ${marketplaceRepo} added` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/already/i.test(msg)) {
          return { success: true, message: `Marketplace ${marketplaceRepo} already added` };
        }
        return { success: false, message: msg };
      }
    },

    async ensureInstalled(pluginName: string): Promise<InstallStepResult> {
      if (await isInstalled(pluginName)) {
        return { success: true, message: `${pluginName} already installed` };
      }
      try {
        await execFileAsync('claude', ['plugin', 'install', pluginName], { timeout: 60_000 });
        return { success: true, message: `${pluginName} installed` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/already/i.test(msg)) {
          return { success: true, message: `${pluginName} already installed` };
        }
        return { success: false, message: msg };
      }
    },
  };
}

/** Check `claude plugin list --json` for the plugin. Errors → not installed. */
async function isInstalled(pluginName: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('claude', ['plugin', 'list', '--json'], {
      timeout: 30_000,
    });
    const parsed: unknown = JSON.parse(stdout);
    const entries = Array.isArray(parsed) ? parsed : [];
    return entries.some((entry) => {
      if (typeof entry !== 'object' || entry === null) return false;
      const e = entry as { name?: string; marketplace?: string; id?: string };
      const id = e.id ?? (e.name && e.marketplace ? `${e.name}@${e.marketplace}` : e.name);
      return id === pluginName || e.name === pluginName;
    });
  } catch {
    return false;
  }
}
