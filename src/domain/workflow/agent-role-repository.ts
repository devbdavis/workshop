import type { PromptBlock, CapabilityTier } from './types.js';

export interface AgentRoleRow {
  id: string;
  name: string;
  description: string;
  promptBlock: PromptBlock;
  toolsAllowed?: string[];
  capabilityTier: CapabilityTier;
  createdByPlaybookRowId?: string;
  reusable: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRoleRepository {
  findById(id: string): AgentRoleRow | null;
  findAll(filters?: { capabilityTier?: string; reusable?: boolean }): AgentRoleRow[];
  findByName(name: string): AgentRoleRow | null;
  create(role: Omit<AgentRoleRow, 'createdAt' | 'updatedAt' | 'usageCount'>): AgentRoleRow;
  update(id: string, changes: Partial<AgentRoleRow>): AgentRoleRow | null;
  incrementUsage(id: string): void;
}
