import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { McpServerConfig, McpInstallResult, McpTransportType } from '@foundation/types';
import type { McpToolAdapter } from './types.js';

const CODEX_CONFIG_PATH = path.join(process.env.HOME || '/tmp', '.codex', 'config.toml');

/**
 * Adapter for Codex CLI's MCP server configuration.
 *
 * Codex stores MCP configs in ~/.codex/config.toml under [mcp_servers.*] sections.
 * There's no CLI command for MCP management, so we read/write the TOML file directly.
 */
export function createCodexAdapter(): McpToolAdapter {
  return {
    tool: 'codex',

    async isAvailable(): Promise<boolean> {
      return existsSync(CODEX_CONFIG_PATH);
    },

    async listServers(): Promise<Partial<McpServerConfig>[]> {
      const config = readConfig();
      if (!config) return [];

      const mcpServers = (config.mcp_servers || {}) as Record<string, TomlMcpEntry>;
      const results: Partial<McpServerConfig>[] = [];

      for (const [name, entry] of Object.entries(mcpServers)) {
        if (typeof entry !== 'object' || entry === null) continue;
        results.push(tomlEntryToConfig(name, entry));
      }
      return results;
    },

    async installServer(config: McpServerConfig): Promise<McpInstallResult> {
      try {
        // Validate we have enough info
        if (config.transportType === 'stdio' && !config.command) {
          return {
            tool: 'codex', serverName: config.name, success: false,
            message: 'Skipped: stdio server has no command configured',
          };
        }
        if ((config.transportType === 'http' || config.transportType === 'sse') && !config.url) {
          return {
            tool: 'codex', serverName: config.name, success: false,
            message: 'Skipped: http/sse server has no URL configured',
          };
        }

        const tomlConfig = readConfig() || {};
        if (!tomlConfig.mcp_servers) {
          tomlConfig.mcp_servers = {};
        }
        const servers = tomlConfig.mcp_servers as Record<string, unknown>;

        if (config.transportType === 'stdio') {
          const entry: Record<string, unknown> = {
            command: config.command || '',
            args: config.args || [],
          };
          if (config.env && Object.keys(config.env).length > 0) {
            entry.env = config.env;
          }
          servers[config.name] = entry;
        } else {
          const entry: Record<string, unknown> = { url: config.url || '' };
          if (config.headers && Object.keys(config.headers).length > 0) {
            entry.http_headers = config.headers;
          }
          servers[config.name] = entry;
        }

        writeConfig(tomlConfig);
        return { tool: 'codex', serverName: config.name, success: true, message: 'Installed' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { tool: 'codex', serverName: config.name, success: false, message: msg };
      }
    },

    async removeServer(name: string): Promise<McpInstallResult> {
      try {
        const tomlConfig = readConfig();
        if (!tomlConfig) {
          return { tool: 'codex', serverName: name, success: false, message: 'Config file not found' };
        }
        const servers = (tomlConfig.mcp_servers || {}) as Record<string, unknown>;
        delete servers[name];
        writeConfig(tomlConfig);
        return { tool: 'codex', serverName: name, success: true, message: 'Removed' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { tool: 'codex', serverName: name, success: false, message: msg };
      }
    },
  };
}

interface TomlMcpEntry {
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  http_headers?: Record<string, string>;
  bearer_token_env_var?: string;
}

function tomlEntryToConfig(name: string, entry: TomlMcpEntry): Partial<McpServerConfig> {
  const config: Partial<McpServerConfig> = { name };

  if (entry.url) {
    config.transportType = entry.url.includes('/sse') ? 'sse' as McpTransportType : 'http' as McpTransportType;
    config.url = entry.url;
    if (entry.http_headers) config.headers = entry.http_headers;
  } else if (entry.command) {
    config.transportType = 'stdio';
    config.command = entry.command;
    config.args = entry.args;
    if (entry.env) config.env = entry.env;
  } else {
    config.transportType = 'stdio';
  }

  return config;
}

function readConfig(): Record<string, unknown> | null {
  if (!existsSync(CODEX_CONFIG_PATH)) return null;
  const content = readFileSync(CODEX_CONFIG_PATH, 'utf-8');
  return parseToml(content) as Record<string, unknown>;
}

function writeConfig(config: Record<string, unknown>): void {
  const content = stringifyToml(config);
  writeFileSync(CODEX_CONFIG_PATH, content, 'utf-8');
}
