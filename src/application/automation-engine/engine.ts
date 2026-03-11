import cron from 'node-cron';
import type {
  AutomationRule,
  AutomationRuleId,
  TriggerType,
  ActionType,
  TrackId,
} from '@foundation/types';
import type { AutomationRuleRepository, AutomationRunRepository } from '@domain/automation/repository';

export interface AutomationEvent {
  type: TriggerType;
  trackId: TrackId;
  data?: Record<string, unknown>;
}

export type ActionHandler = (rule: AutomationRule, event: AutomationEvent) => Promise<void>;

export interface AutomationEngine {
  start(): void;
  stop(): void;
  triggerEvent(event: AutomationEvent): Promise<void>;
  triggerRule(ruleId: AutomationRuleId): Promise<void>;
  registerActionHandler(actionType: ActionType, handler: ActionHandler): void;
}

interface ScheduledTask {
  ruleId: AutomationRuleId;
  task: cron.ScheduledTask;
}

export function createAutomationEngine(
  ruleRepo: AutomationRuleRepository,
  runRepo: AutomationRunRepository,
): AutomationEngine {
  const actionHandlers = new Map<ActionType, ActionHandler>();
  const scheduledTasks: ScheduledTask[] = [];

  function clearScheduledTasks(): void {
    for (const entry of scheduledTasks) {
      entry.task.stop();
    }
    scheduledTasks.length = 0;
  }

  function scheduleRule(rule: AutomationRule): void {
    const cronExpression = rule.triggerConfig?.cron as string | undefined;
    if (!cronExpression || !cron.validate(cronExpression)) {
      console.warn(`Automation rule "${rule.name}" (${rule.id}) has invalid or missing cron expression: ${cronExpression}`);
      return;
    }

    const task = cron.schedule(cronExpression, () => {
      const event: AutomationEvent = {
        type: 'schedule',
        trackId: rule.trackId,
        data: { scheduled: true },
      };
      // Fire and forget — errors are logged inside executeRule
      void executeRule(rule, event);
    });

    scheduledTasks.push({ ruleId: rule.id, task });
  }

  async function executeRule(rule: AutomationRule, event: AutomationEvent): Promise<void> {
    const handler = actionHandlers.get(rule.actionType);
    if (!handler) {
      console.warn(`No action handler registered for type "${rule.actionType}"`);
      return;
    }

    // Create a run record
    const run = runRepo.create({
      ruleId: rule.id,
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    try {
      await handler(rule, event);
      runRepo.complete(run.id, 'completed');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Automation rule "${rule.name}" (${rule.id}) failed:`, message);
      runRepo.complete(run.id, 'failed', { error: message });
    }
  }

  return {
    start(): void {
      // Load all enabled schedule rules and create cron jobs
      const enabledRules = ruleRepo.findEnabled();
      const scheduleRules = enabledRules.filter((r) => r.triggerType === 'schedule');
      for (const rule of scheduleRules) {
        scheduleRule(rule);
      }
      console.log(`Automation engine started: ${scheduleRules.length} schedule rule(s) loaded`);
    },

    stop(): void {
      clearScheduledTasks();
      console.log('Automation engine stopped');
    },

    async triggerEvent(event: AutomationEvent): Promise<void> {
      const rules = ruleRepo.findEnabled().filter(
        (r) => r.triggerType === event.type && r.trackId === event.trackId,
      );

      // Execute all matching rules concurrently; errors are handled per-rule
      await Promise.allSettled(rules.map((rule) => executeRule(rule, event)));
    },

    async triggerRule(ruleId: AutomationRuleId): Promise<void> {
      const rule = ruleRepo.findById(ruleId);
      if (!rule) {
        throw new Error(`Automation rule not found: ${ruleId}`);
      }
      const event: AutomationEvent = {
        type: 'manual',
        trackId: rule.trackId,
        data: { ruleId: rule.id, triggeredManually: true },
      };
      await executeRule(rule, event);
    },

    registerActionHandler(actionType: ActionType, handler: ActionHandler): void {
      actionHandlers.set(actionType, handler);
    },
  };
}
