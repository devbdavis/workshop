/**
 * Topology loader — loads workflow stage definitions from playbooks
 * and provides caching to avoid repeated JSON parsing + Zod validation.
 */
import type { WorkflowTicket } from '@foundation/types.js';
import type { StageDefinition } from '@domain/workflow/types.js';
import type { PlaybookRow, PlaybookRepository } from '@domain/workflow/playbook-repository.js';

export interface TopologyLoader {
  /** Load stage definitions for a ticket (requires playbookRowId) */
  loadForTicket(ticket: WorkflowTicket): StageDefinition[];

  /** Load stage definitions by playbook row_id */
  loadByPlaybookRowId(rowId: string): StageDefinition[];

  /** Load the full playbook row for a ticket (null if no playbook bound) */
  loadPlaybookForTicket(ticket: WorkflowTicket): PlaybookRow | null;

  /** Clear the cache (useful for testing or playbook updates) */
  clearCache(): void;
}

export function createTopologyLoader(deps: {
  playbooks: PlaybookRepository;
}): TopologyLoader {
  const { playbooks } = deps;

  // LRU cache keyed by row_id to avoid repeated JSON parsing + Zod validation
  const cache = new Map<string, StageDefinition[]>();
  const MAX_CACHE_SIZE = 100;

  function loadAndCache(rowId: string): StageDefinition[] {
    const cached = cache.get(rowId);
    if (cached) return cached;

    const playbook = playbooks.findByRowId(rowId);
    if (!playbook) {
      throw new Error(`Workflow playbook not found: row_id=${rowId}`);
    }

    const stages = playbook.stageDefinitions; // already parsed by repository

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
      if (!ticket.playbookRowId) {
        throw new Error(
          `Ticket ${ticket.id} has no workflow playbook assigned. ` +
          `Cannot load topology without a playbook binding.`
        );
      }
      return loadAndCache(ticket.playbookRowId);
    },

    loadByPlaybookRowId(rowId: string): StageDefinition[] {
      return loadAndCache(rowId);
    },

    loadPlaybookForTicket(ticket: WorkflowTicket): PlaybookRow | null {
      if (!ticket.playbookRowId) return null;
      return playbooks.findByRowId(ticket.playbookRowId);
    },

    clearCache(): void {
      cache.clear();
    },
  };
}
