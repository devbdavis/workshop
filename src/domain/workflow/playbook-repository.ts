import type { StageDefinition, MatchCriteria, PromptOverrides } from './types.js';

export interface PlaybookRow {
  rowId: string;
  id: string;
  version: number;
  name: string;
  description: string;
  ticketType: 'epic' | 'task';
  stageDefinitions: StageDefinition[];
  promptOverrides?: PromptOverrides;
  tags?: string[];
  matchCriteria?: MatchCriteria;
  usageCount: number;
  avgRating?: number;
  parentPlaybookId?: string;
  isLatest: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface PlaybookRepository {
  findByRowId(rowId: string): PlaybookRow | null;
  findLatest(id: string): PlaybookRow | null;
  findByIdAndVersion(id: string, version: number): PlaybookRow | null;
  findAllLatest(filters?: { ticketType?: string; tags?: string[] }): PlaybookRow[];
  /** Find the latest task playbook whose parentPlaybookId matches the given epic playbook ID */
  findTaskPlaybookByParent(parentPlaybookId: string): PlaybookRow | null;
  create(playbook: Omit<PlaybookRow, 'rowId' | 'createdAt' | 'updatedAt' | 'isLatest'>): PlaybookRow;
  createNewVersion(id: string, changes: Partial<PlaybookRow>): PlaybookRow;
  incrementUsage(rowId: string): void;
  updateRating(rowId: string, rating: number): void;
}
