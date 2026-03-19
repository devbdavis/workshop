import { execFile } from 'child_process';
import { promisify } from 'util';
import type { McpServerConfig, McpInstallResult } from '@foundation/types';
import type { McpToolAdapter } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Adapter for Gemini CLI's MCP server configuration.
 *
 * Uses `gemini mcp add/remove/list` commands. The Gemini CLI manages its
 * own internal config store; we don't write config files directly.
 */
export function createGeminiAdapter(): McpToolAdapter {
  return {
    tool: 'gemini',

    async isAvailable(): Promise<boolean> {
      try {
        await execFileAsync('which', ['gemini']);
        return true;
      } catch {
        return false;
      }
    },

    async listServers(): Promise<Partial<McpServerConfig>[]> {
      try {
        const { stdout } = await execFileAsync('gemini', ['mcp', 'list'], {
          timeout: 15_000,
        });
        return parseGeminiList(stdout);
      } catch {
        return [];
      }
    },

    async installServer(config: McpServerConfig): Promise<McpInstallResult> {
      try {
        // Validate we have enough info
        if (config.transportType === 'stdio' && !config.command) {
          return {
            tool: 'gemini', serverName: config.name, success: false,
            message: 'Skipped: stdio server has no command configured',
          };
        }
        if ((config.transportType === 'http' || config.transportType === 'sse') && !config.url) {
          return {
            tool: 'gemini', serverName: config.name, success: false,
            message: 'Skipped: http/sse server has no URL configured',
          };
        }

        const args = buildGeminiAddArgs(config);
        await execFileAsync('gemini', args, { timeout: 15_000 });
        return { tool: 'gemini', serverName: config.name, success: true, message: 'Installed' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { tool: 'gemini', serverName: config.name, success: false, message: msg };
      }
    },

    async removeServer(name: string): Promise<McpInstallResult> {
      try {
        await execFileAsync('gemini', ['mcp', 'remove', name], {
          timeout: 15_000,
        });
        return { tool: 'gemini', serverName: name, success: true, message: 'Removed' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { tool: 'gemini', serverName: name, success: false, message: msg };
      }
    },
  };
}

/** Build args array for `gemini mcp add` */
function buildGeminiAddArgs(config: McpServerConfig): string[] {
  const args = ['mcp', 'add'];

  if (config.transportType === 'stdio') {
    args.push(config.name, config.command || '');
    if (config.args) args.push(...config.args);
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }
  } else {
    args.push(config.name, config.url || '');
    args.push('--transport', config.transportType);
  }

  return args;
}

/** Parse `gemini mcp list` output into partial configs */
function parseGeminiList(stdout: string): Partial<McpServerConfig>[] {
  const results: Partial<McpServerConfig>[] = [];

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const name = trimmed.slice(0, colonIdx).trim();
      if (name && !name.includes(' ')) {
        results.push({ name, transportType: 'stdio' });
      }
    }
  }
  return results;
}
