import { execFile } from 'child_process';
import { promisify } from 'util';
import type { InstallStepResult, PluginInstaller } from '@domain/plugin/installer';

const execFileAsync = promisify(execFile);

/**
 * Gemini CLI extension installer — `gemini extensions install <repo-url>`.
 *
 * Gemini has no separate marketplace registration step, so
 * ensureMarketplaceAdded is a no-op. Only meaningful for plugin repos that
 * ship a gemini-extension.json (callers gate on detected providers).
 */
export function createGeminiExtensionInstaller(): PluginInstaller {
  return {
    async isAvailable(): Promise<boolean> {
      try {
        await execFileAsync('which', ['gemini'], { timeout: 15_000 });
        return true;
      } catch {
        return false;
      }
    },

    async ensureMarketplaceAdded(): Promise<InstallStepResult> {
      return { success: true, message: 'Gemini has no marketplace step' };
    },

    async ensureInstalled(pluginName: string, marketplaceRepo: string): Promise<InstallStepResult> {
      const url = `https://github.com/${marketplaceRepo}`;
      try {
        await execFileAsync('gemini', ['extensions', 'install', url], { timeout: 120_000 });
        return { success: true, message: `${pluginName} installed as Gemini extension` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/already/i.test(msg)) {
          return { success: true, message: `${pluginName} already installed as Gemini extension` };
        }
        return { success: false, message: msg };
      }
    },
  };
}
