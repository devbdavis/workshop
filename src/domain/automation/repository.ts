import type {
  AutomationRule,
  AutomationRuleId,
  AutomationRun,
  TrackId,
  TriggerType,
} from '@foundation/types';

export interface AutomationRuleRepository {
  findById(id: AutomationRuleId): AutomationRule | null;
  findByTrack(trackId: TrackId): AutomationRule[];
  findByTriggerType(triggerType: TriggerType): AutomationRule[];
  findEnabled(): AutomationRule[];
  create(rule: Omit<AutomationRule, 'id' | 'createdAt' | 'updatedAt'>): AutomationRule;
  update(
    id: AutomationRuleId,
    data: Partial<Pick<AutomationRule, 'name' | 'triggerType' | 'triggerConfig' | 'actionType' | 'actionConfig' | 'enabled'>>,
  ): AutomationRule | null;
  delete(id: AutomationRuleId): boolean;
}

export interface AutomationRunRepository {
  findByRule(ruleId: AutomationRuleId): AutomationRun[];
  create(run: Omit<AutomationRun, 'id'>): AutomationRun;
  complete(id: string, status: 'completed' | 'failed', result?: Record<string, unknown>): AutomationRun | null;
}
