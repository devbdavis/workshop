import type { McpServerConfig, McpServerConfigId } from '@foundation/types';

export interface McpServerConfigRepository {
  findAll(): McpServerConfig[];
  findById(id: McpServerConfigId): McpServerConfig | null;
  findByName(name: string): McpServerConfig | null;
  create(data: Omit<McpServerConfig, 'id' | 'createdAt' | 'updatedAt'>): McpServerConfig;
  update(
    id: McpServerConfigId,
    data: Partial<Pick<McpServerConfig,
      'name' | 'transportType' | 'command' | 'args' | 'env' | 'url' | 'headers' | 'enabled'
    >>,
  ): McpServerConfig | null;
  /** Insert or update by name — used for idempotent import */
  upsertByName(data: Omit<McpServerConfig, 'id' | 'createdAt' | 'updatedAt'>): McpServerConfig;
  delete(id: McpServerConfigId): boolean;
}
