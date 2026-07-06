import type { PromptTemplate, PromptTemplateSystemKind, TemplateId } from '@foundation/types';

export interface PromptTemplateRepository {
  findAll(): PromptTemplate[];
  findById(id: TemplateId): PromptTemplate | null;
  findDefault(): PromptTemplate | null;
  /** Returns the singleton template Workshop manages for the given kind, if it exists. */
  findBySystemKind(kind: PromptTemplateSystemKind): PromptTemplate | null;
  create(data: { name: string; description?: string; content: string }): PromptTemplate;
  update(id: TemplateId, data: Partial<Pick<PromptTemplate, 'name' | 'description' | 'content'>>): PromptTemplate | null;
  delete(id: TemplateId): boolean;
}
