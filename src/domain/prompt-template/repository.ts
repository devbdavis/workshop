import type { PromptTemplate, TemplateId } from '@foundation/types';

export interface PromptTemplateRepository {
  findAll(): PromptTemplate[];
  findById(id: TemplateId): PromptTemplate | null;
  create(data: { name: string; description?: string; content: string }): PromptTemplate;
  update(id: TemplateId, data: Partial<Pick<PromptTemplate, 'name' | 'description' | 'content'>>): PromptTemplate | null;
  delete(id: TemplateId): boolean;
}
