import type { StageDefinition, MatchCriteria, PromptOverrides } from './types.js';

export interface WorkflowTemplateRow {
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
  parentTemplateId?: string;
  isLatest: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface WorkflowTemplateRepository {
  findByRowId(rowId: string): WorkflowTemplateRow | null;
  findLatest(id: string): WorkflowTemplateRow | null;
  findByIdAndVersion(id: string, version: number): WorkflowTemplateRow | null;
  findAllLatest(filters?: { ticketType?: string; tags?: string[] }): WorkflowTemplateRow[];
  /** Find the latest task template whose parentTemplateId matches the given epic template ID */
  findTaskTemplateByParent(parentTemplateId: string): WorkflowTemplateRow | null;
  create(template: Omit<WorkflowTemplateRow, 'rowId' | 'createdAt' | 'updatedAt' | 'isLatest'>): WorkflowTemplateRow;
  createNewVersion(id: string, changes: Partial<WorkflowTemplateRow>): WorkflowTemplateRow;
  incrementUsage(rowId: string): void;
  updateRating(rowId: string, rating: number): void;
}
