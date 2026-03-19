import type { McpServerConfig, McpInstallResult } from '@foundation/types';

export type CliTool = 'claude' | 'codex' | 'gemini';

/** Common interface for reading/writing MCP configs in a CLI tool */
export interface McpToolAdapter {
  tool: CliTool;
  /** Check whether the CLI binary is installed */
  isAvailable(): Promise<boolean>;
  /** Read all MCP server configs from this tool */
  listServers(): Promise<Partial<McpServerConfig>[]>;
  /** Idempotently install a server config */
  installServer(config: McpServerConfig): Promise<McpInstallResult>;
  /** Remove a server config by name */
  removeServer(name: string): Promise<McpInstallResult>;
}
