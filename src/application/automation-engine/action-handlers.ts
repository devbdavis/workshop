import type { AutomationEngine, ActionHandler } from './engine.js';

/**
 * Register all built-in action handlers on the automation engine.
 *
 * @param engine - The automation engine to register handlers on
 */
export function registerActionHandlers(
  engine: AutomationEngine,
): void {
  // sync-issues: placeholder
  const syncIssues: ActionHandler = async (rule, _event) => {
    console.log(`sync-issues: issue sync not yet implemented (rule "${rule.name}", track ${rule.trackId})`);
  };

  // run-agent-prompt: placeholder
  const runAgentPrompt: ActionHandler = async (rule, _event) => {
    console.log(`run-agent-prompt: agent prompt not yet implemented (rule "${rule.name}", track ${rule.trackId})`);
  };

  engine.registerActionHandler('sync-issues', syncIssues);
  engine.registerActionHandler('run-agent-prompt', runAgentPrompt);
}
