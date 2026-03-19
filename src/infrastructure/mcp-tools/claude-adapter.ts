import { execFile } from 'child_process';
import { promisify } from 'util';
import type { McpServerConfig, McpInstallResult, McpTransportType } from '@foundation/types';
import type { McpToolAdapter } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Adapter for Claude Code's MCP server management.
 *
 * Uses the `claude mcp` CLI to list, add, and remove servers.
 * Import parses `claude mcp list` output, then fetches details per-server
 * via `claude mcp get <name>`.
 */
export function createClaudeAdapter(): McpToolAdapter {
  return {
    tool: 'claude',

    async isAvailable(): Promise<boolean> {
      try {
        await execFileAsync('which', ['claude']);
        return true;
      } catch {
        return false;
      }
    },

    async listServers(): Promise<Partial<McpServerConfig>[]> {
      const { stdout } = await execFileAsync('claude', ['mcp', 'list'], {
        timeout: 30_000,
      });

      // Parse server names from the list output.
      // Lines look like:
      //   atlassian: https://mcp.atlassian.com/v1/sse (SSE) - ✓ Connected
      //   workshop: npx tsx /path/to/server.ts - ✓ Connected
      //   claude.ai Gmail: https://... - ✓ Connected   (skip claude.ai managed ones)
      const names: string[] = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('Checking')) continue;
        if (trimmed.startsWith('claude.ai ')) continue;
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0) {
          names.push(trimmed.slice(0, colonIdx).trim());
        }
      }

      const results: Partial<McpServerConfig>[] = [];
      for (const name of names) {
        try {
          const config = await getServerDetails(name);
          if (config) results.push(config);
        } catch {
          results.push({ name, transportType: 'stdio' as McpTransportType });
        }
      }
      return results;
    },

    async installServer(config: McpServerConfig): Promise<McpInstallResult> {
      try {
        // Validate the config has enough info to install
        if (config.transportType === 'stdio' && !config.command) {
          return {
            tool: 'claude', serverName: config.name, success: false,
            message: 'Skipped: stdio server has no command configured',
          };
        }
        if ((config.transportType === 'http' || config.transportType === 'sse') && !config.url) {
          return {
            tool: 'claude', serverName: config.name, success: false,
            message: 'Skipped: http/sse server has no URL configured',
          };
        }

        const json = buildClaudeJson(config);

        // `claude mcp add-json` errors if server already exists at that scope,
        // so we remove first (ignore errors if it doesn't exist) then add.
        try {
          await execFileAsync('claude', ['mcp', 'remove', config.name, '-s', 'user'], {
            timeout: 15_000,
          });
        } catch {
          // Server didn't exist — that's fine
        }

        await execFileAsync('claude', [
          'mcp', 'add-json', '-s', 'user', config.name, json,
        ], { timeout: 15_000 });

        return { tool: 'claude', serverName: config.name, success: true, message: 'Installed' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { tool: 'claude', serverName: config.name, success: false, message: msg };
      }
    },

    async removeServer(name: string): Promise<McpInstallResult> {
      try {
        await execFileAsync('claude', ['mcp', 'remove', name, '-s', 'user'], {
          timeout: 15_000,
        });
        return { tool: 'claude', serverName: name, success: true, message: 'Removed' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { tool: 'claude', serverName: name, success: false, message: msg };
      }
    },
  };
}

/** Parse `claude mcp get <name>` output into a partial config */
async function getServerDetails(name: string): Promise<Partial<McpServerConfig> | null> {
  const { stdout } = await execFileAsync('claude', ['mcp', 'get', name], {
    timeout: 15_000,
  });

  const lines = stdout.split('\n').map((l) => l.trim());
  const config: Partial<McpServerConfig> = { name };

  for (const line of lines) {
    if (line.startsWith('Type:')) {
      const t = line.replace('Type:', '').trim().toLowerCase();
      if (t === 'stdio' || t === 'http' || t === 'sse') {
        config.transportType = t;
      }
    } else if (line.startsWith('URL:')) {
      config.url = line.replace('URL:', '').trim();
    } else if (line.startsWith('Command:')) {
      config.command = line.replace('Command:', '').trim();
    } else if (line.startsWith('Args:')) {
      const argsStr = line.replace('Args:', '').trim();
      config.args = argsStr.split(/\s+/).filter(Boolean);
    }
  }

  // Parse environment variables (indented KEY=VALUE lines after "Environment:")
  const envIdx = lines.findIndex((l) => l.startsWith('Environment:'));
  if (envIdx >= 0) {
    config.env = {};
    for (let i = envIdx + 1; i < lines.length; i++) {
      const eqIdx = lines[i].indexOf('=');
      if (eqIdx > 0 && !lines[i].includes(':')) {
        const key = lines[i].slice(0, eqIdx).trim();
        const value = lines[i].slice(eqIdx + 1).trim();
        config.env[key] = value;
      } else {
        break;
      }
    }
    if (Object.keys(config.env).length === 0) delete config.env;
  }

  // Default to stdio if type wasn't reported
  if (!config.transportType) {
    config.transportType = config.url ? 'http' : 'stdio';
  }

  return config;
}

/** Build the JSON string that `claude mcp add-json` expects */
function buildClaudeJson(config: McpServerConfig): string {
  if (config.transportType === 'stdio') {
    const obj: Record<string, unknown> = { command: config.command, args: config.args || [] };
    if (config.env && Object.keys(config.env).length > 0) obj.env = config.env;
    return JSON.stringify(obj);
  }
  const obj: Record<string, unknown> = { type: config.transportType, url: config.url };
  if (config.headers && Object.keys(config.headers).length > 0) obj.headers = config.headers;
  return JSON.stringify(obj);
}
