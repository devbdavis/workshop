import type { AutomationEngine, ActionHandler } from './engine.js';

/**
 * A minimal interface for the summary generation service.
 * The automation engine accepts this as a dependency rather than importing it directly.
 */
export interface SummaryGenerationDependency {
  generateSummary(trackId: string): Promise<unknown>;
}

/**
 * Register all built-in action handlers on the automation engine.
 *
 * @param engine - The automation engine to register handlers on
 * @param summaryService - Optional summary generation service for the regenerate-summary action
 */
export function registerActionHandlers(
  engine: AutomationEngine,
  summaryService?: SummaryGenerationDependency,
): void {
  // regenerate-summary: calls the summary generation service
  const regenerateSummary: ActionHandler = async (rule, _event) => {
    if (!summaryService) {
      console.log(`regenerate-summary: summary service not available, skipping rule "${rule.name}"`);
      return;
    }
    await summaryService.generateSummary(rule.trackId);
  };

  // sync-tickets: placeholder
  const syncTickets: ActionHandler = async (rule, _event) => {
    console.log(`sync-tickets: ticket sync not yet implemented (rule "${rule.name}", track ${rule.trackId})`);
  };

  // run-agent-prompt: placeholder
  const runAgentPrompt: ActionHandler = async (rule, _event) => {
    console.log(`run-agent-prompt: agent prompt not yet implemented (rule "${rule.name}", track ${rule.trackId})`);
  };

  engine.registerActionHandler('regenerate-summary', regenerateSummary);
  engine.registerActionHandler('sync-tickets', syncTickets);
  engine.registerActionHandler('run-agent-prompt', runAgentPrompt);
}
