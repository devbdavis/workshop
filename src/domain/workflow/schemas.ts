import { z } from 'zod';

// --- Trigger types (closed set — engine mechanics, not topology) ---
export const TransitionTriggerSchema = z.enum([
  'agent-complete',
  'human-approve',
  'human-reject',
  'auto',
  'all-deps-resolved',
  'all-tasks-done',
  'manual',
  'execution-complete',
  'execution-failed',
]);

// --- Capability tiers for agent roles (closed set) ---
export const CapabilityTierSchema = z.enum([
  'advisory',           // read-only, no code changes
  'code-modification',  // can edit files, run builds
  'infrastructure',     // can touch infra, deploy, etc.
]);

// --- Semantic role: classifies each state for UI rendering ---
export const SemanticRoleSchema = z.enum([
  'entry',        // workflow start state
  'processing',   // agent or system working
  'human-gate',   // requires human decision
  'terminal',     // end state (done, merged, cancelled)
  'error',        // failure/stuck state
  'waiting',      // blocked on external dependency
]);

// --- Single transition edge ---
export const TransitionSchema = z.object({
  to: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
  trigger: TransitionTriggerSchema,
  condition: z.string().max(256).optional(),
});

// --- Single stage (node in the workflow graph) ---
export const StageDefinitionSchema = z.object({
  state: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
  semanticRole: SemanticRoleSchema,
  agentActionable: z.boolean(),
  humanGate: z.boolean(),
  autoApprovable: z.boolean().optional(),
  agentRoleId: z.string().optional(),
  agentCount: z.number().int().min(1).max(10).optional(),
  parallel: z.boolean().optional(),
  validTransitions: z.array(TransitionSchema).max(15),
  promptOverride: z.string().max(10000).optional(),
});

// --- Complete workflow template payload ---
export const StageDefinitionsSchema = z.array(StageDefinitionSchema)
  .min(1)
  .max(50);

// --- Match criteria (structured, not freeform) ---
export const MatchCriteriaSchema = z.object({
  keywords: z.array(z.string().max(64)).max(20),
  complexity: z.enum(['trivial', 'simple', 'moderate', 'complex']).optional(),
  domains: z.array(z.string().max(64)).max(10).optional(),
  requiresHumanGate: z.boolean().optional(),
});

// --- Template-level prompt overrides keyed by agentRoleId ---
export const PromptOverridesSchema = z.record(
  z.string().max(128),
  z.string().max(10000),
);

// --- Prompt building blocks for agent roles ---
export const PromptBlockSchema = z.object({
  preamble: z.string().max(5000),
  toolAccessTier: CapabilityTierSchema,
  constraints: z.array(z.string().max(500)).max(20),
  completionInstructions: z.string().max(2000),
});

// --- Agent role definition ---
export const AgentRoleSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(128),
  description: z.string().max(2000),
  promptBlock: PromptBlockSchema,
  toolsAllowed: z.array(z.string().max(128)).max(50),
  capabilityTier: CapabilityTierSchema,
  reusable: z.boolean().default(true),
});

// --- Workflow review findings ---
export const ReviewFindingSchema = z.object({
  category: z.enum(['timing', 'retry-loop', 'human-intervention', 'stuck-state', 'success-pattern']),
  description: z.string().max(2000),
  severity: z.enum(['info', 'warning', 'actionable']),
  stateRef: z.string().optional(),
});

export const SuggestedChangeSchema = z.object({
  type: z.enum(['add-state', 'remove-state', 'modify-transition', 'modify-agent', 'modify-prompt']),
  description: z.string().max(2000),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});
