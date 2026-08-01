import { z } from 'zod';
import {
  StageDefinitionSchema,
  StageDefinitionsSchema,
  MatchCriteriaSchema,
  AgentRoleSchema,
  PromptBlockSchema,
  PromptOverridesSchema,
  ReviewFindingSchema,
  SuggestedChangeSchema,
  CapabilityTierSchema,
  TransitionTriggerSchema,
  SemanticRoleSchema,
  TransitionSchema,
} from './schemas.js';

export type StageDefinition = z.infer<typeof StageDefinitionSchema>;
export type StageDefinitions = z.infer<typeof StageDefinitionsSchema>;
export type MatchCriteria = z.infer<typeof MatchCriteriaSchema>;
export type AgentRole = z.infer<typeof AgentRoleSchema>;
export type PromptBlock = z.infer<typeof PromptBlockSchema>;
export type PromptOverrides = z.infer<typeof PromptOverridesSchema>;
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type SuggestedChange = z.infer<typeof SuggestedChangeSchema>;
export type CapabilityTier = z.infer<typeof CapabilityTierSchema>;
export type TransitionTrigger = z.infer<typeof TransitionTriggerSchema>;
export type SemanticRole = z.infer<typeof SemanticRoleSchema>;
export type Transition = z.infer<typeof TransitionSchema>;

// Runtime equivalents of the old compile-time type guards
export function isHumanGate(stages: StageDefinition[], state: string): boolean {
  const stage = stages.find(s => s.state === state);
  return stage?.humanGate === true;
}

export function isTerminal(stages: StageDefinition[], state: string): boolean {
  const stage = stages.find(s => s.state === state);
  if (!stage) return true;
  return stage.validTransitions.length === 0;
}

/** Absent/undefined means auto-approvable; only an explicit `false` blocks it (e.g. merge gate). */
export function canAutoApprove(stage: StageDefinition): boolean {
  return stage.autoApprovable !== false;
}

export function isAgentActionable(stages: StageDefinition[], state: string): boolean {
  const stage = stages.find(s => s.state === state);
  return stage?.agentActionable === true;
}

export function getStageDefinition(stages: StageDefinition[], state: string): StageDefinition | undefined {
  return stages.find(s => s.state === state);
}

export function getSemanticRole(stages: StageDefinition[], state: string): SemanticRole | undefined {
  return stages.find(s => s.state === state)?.semanticRole;
}
