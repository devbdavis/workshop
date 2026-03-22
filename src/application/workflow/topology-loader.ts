/**
 * Topology loader — loads workflow stage definitions from templates
 * and provides caching to avoid repeated JSON parsing + Zod validation.
 */
import type { WorkflowTicket } from '@foundation/types.js';
import type { StageDefinition } from './types.js';
import type { WorkflowTemplateRow, WorkflowTemplateRepository } from './template-repository.js';

export interface TopologyLoader {
  /** Load stage definitions for a ticket (requires workflowTemplateRowId) */
  loadForTicket(ticket: WorkflowTicket): StageDefinition[];

  /** Load stage definitions by template row_id */
  loadByTemplateRowId(rowId: string): StageDefinition[];

  /** Load the full template row for a ticket (null if no template bound) */
  loadTemplateForTicket(ticket: WorkflowTicket): WorkflowTemplateRow | null;

  /** Clear the cache (useful for testing or template updates) */
  clearCache(): void;
}

export function createTopologyLoader(deps: {
  templates: WorkflowTemplateRepository;
}): TopologyLoader {
  const { templates } = deps;

  // LRU cache keyed by row_id to avoid repeated JSON parsing + Zod validation
  const cache = new Map<string, StageDefinition[]>();
  const MAX_CACHE_SIZE = 100;

  function loadAndCache(rowId: string): StageDefinition[] {
    const cached = cache.get(rowId);
    if (cached) return cached;

    const template = templates.findByRowId(rowId);
    if (!template) {
      throw new Error(`Workflow template not found: row_id=${rowId}`);
    }

    const stages = template.stageDefinitions; // already parsed by repository

    // Evict oldest if cache is full
    if (cache.size >= MAX_CACHE_SIZE) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
    cache.set(rowId, stages);
    return stages;
  }

  return {
    loadForTicket(ticket: WorkflowTicket): StageDefinition[] {
      if (!ticket.workflowTemplateRowId) {
        throw new Error(
          `Ticket ${ticket.id} has no workflow template assigned. ` +
          `Cannot load topology without a template binding.`
        );
      }
      return loadAndCache(ticket.workflowTemplateRowId);
    },

    loadByTemplateRowId(rowId: string): StageDefinition[] {
      return loadAndCache(rowId);
    },

    loadTemplateForTicket(ticket: WorkflowTicket): WorkflowTemplateRow | null {
      if (!ticket.workflowTemplateRowId) return null;
      return templates.findByRowId(ticket.workflowTemplateRowId);
    },

    clearCache(): void {
      cache.clear();
    },
  };
}
