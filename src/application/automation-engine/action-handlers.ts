import type { AutomationEngine, ActionHandler } from './engine.js';

/**
 * Register all built-in action handlers on the automation engine.
 *
 * @param engine - The automation engine to register handlers on
 */
export function registerActionHandlers(
  engine: AutomationEngine,
): void {
  // sync-tickets: placeholder
  const syncTickets: ActionHandler = async (rule, _event) => {
    console.log(`sync-tickets: ticket sync not yet implemented (rule "${rule.name}", track ${rule.trackId})`);
  };

  // run-agent-prompt: placeholder
  const runAgentPrompt: ActionHandler = async (rule, _event) => {
    console.log(`run-agent-prompt: agent prompt not yet implemented (rule "${rule.name}", track ${rule.trackId})`);
  };

  engine.registerActionHandler('sync-tickets', syncTickets);
  engine.registerActionHandler('run-agent-prompt', runAgentPrompt);
}
