# Dynamic Workflow Orchestration Engine — Implementation Plan

## Overview

Replace the entire hardcoded workflow system (static state machines in `state-machine.ts`, static templates in `templates.ts`, tightly coupled prompt composer) with a dynamic, self-improving workflow orchestration engine. Workflows are selected or created at runtime via a Claude skill, stored in the database, and improved over time through post-implementation retrospective reviews.

**Wholesale replacement** — no backward compatibility with old `EPIC_STAGES`/`TASK_STAGES`. The old system stops existing when this ships; it won't affect production until a rebuild and restart is done.

**No seed templates** — the template library grows organically from actual usage. The selection skill creates templates on-demand when epics are created.

---

## Phase 1: JSON Schema Contract + Runtime Validation (MUST complete first)

Everything else depends on these schemas being locked. The engine refactor, skill creation, and UI work all build against these contracts.

### 1A. Zod Schemas for Workflow Definitions

> **[Type Safety]**: The current system uses compile-time union types (`WorkflowState`, `AgentRole`, `HumanGateState`) and type guards (`isHumanGate`). Dynamic workflows make all of these `string`. We replace compile-time safety with runtime Zod validation at every boundary.

Create `src/application/workflow/schemas.ts`:

```typescript
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
  agentRoleId: z.string().optional(),       // references workflow_agent_roles.id
  agentCount: z.number().int().min(1).max(10).optional(),
  parallel: z.boolean().optional(),
  validTransitions: z.array(TransitionSchema).max(15),  // fan-out cap
  promptOverride: z.string().max(10000).optional(),      // per-stage prompt fragment
});

// --- Complete workflow template payload (the stage_definitions JSON) ---
export const StageDefinitionsSchema = z.array(StageDefinitionSchema)
  .min(1)
  .max(50);   // complexity bound: max 50 states

// --- Match criteria (structured, not freeform) ---
export const MatchCriteriaSchema = z.object({
  keywords: z.array(z.string().max(64)).max(20),
  complexity: z.enum(['trivial', 'simple', 'moderate', 'complex']).optional(),
  domains: z.array(z.string().max(64)).max(10).optional(),
  requiresHumanGate: z.boolean().optional(),
});

// --- Template-level prompt overrides keyed by agentRoleId ---
export const PromptOverridesSchema = z.record(
  z.string().max(128),  // agentRoleId key
  z.string().max(10000), // override prompt fragment
);

// --- Prompt building blocks for agent roles ---
export const PromptBlockSchema = z.object({
  preamble: z.string().max(5000),              // vetted role description
  toolAccessTier: CapabilityTierSchema,
  constraints: z.array(z.string().max(500)).max(20),  // guardrails
  completionInstructions: z.string().max(2000),        // how to signal done
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
```

**Why Zod**: It gives us runtime validation + TypeScript type inference (`z.infer<typeof StageDefinitionSchema>`) — we get type safety back without compile-time union types. Every boundary where data enters the system (skill output, API input, DB read) passes through Zod parse.

### 1B. Type Exports

Create `src/application/workflow/types.ts` — derived types from schemas:

```typescript
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
```

### 1C. Graph Validator (pure domain function)

Create `src/application/workflow/graph-validator.ts`:

```typescript
export interface GraphValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateWorkflowGraph(stages: StageDefinition[]): GraphValidationResult;
```

Validation rules:
1. **Reachability**: Every state reachable from the entry state (first in array) via BFS
2. **Terminal states**: At least one state with zero outgoing transitions
3. **No orphans**: No state unreachable from entry
4. **All transition targets exist**: Every `to` in transitions references a state defined in the array
5. **No infinite auto-transition loops**: Follow auto-transition chains; error if cycle detected
6. **Fan-out cap**: No state has more than 15 outgoing transitions (enforced by Zod, validated here too)
7. **State count cap**: Max 50 states (enforced by Zod, validated here too)
8. **State name uniqueness**: No duplicate state names
9. **Human gate enforcement**: Every workflow with more than 2 states must include at least one `humanGate: true` state (prevents prompt injection from skipping all human oversight)
10. **Capability tier gating**: Any state referencing an agent role with `capabilityTier` above `advisory` must have a `human-approve` trigger on at least one inbound transition path

### 1D. Dependency: Add Zod

```bash
npm install zod
```

Zod is zero-dependency, ~50KB. Justified because it replaces an entire compile-time type system with runtime equivalents.

**Files created in Phase 1:**
- `src/application/workflow/schemas.ts`
- `src/application/workflow/types.ts`
- `src/application/workflow/graph-validator.ts`

---

## Phase 2: Database Tables + Repositories

### 2A. New Tables

Add to `src/infrastructure/persistence/database.ts` as new migration blocks:

#### `workflow_templates` table

> Use a surrogate `row_id` as actual PK, with a unique constraint on `(id, version)`. This allows storing multiple versions of the same template.

```sql
CREATE TABLE workflow_templates (
  row_id TEXT PRIMARY KEY,                    -- surrogate PK (UUID)
  id TEXT NOT NULL,                            -- stable template identifier
  version INTEGER NOT NULL DEFAULT 1,          -- monotonically increasing per id
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  ticket_type TEXT NOT NULL CHECK(ticket_type IN ('epic', 'task')),
  stage_definitions TEXT NOT NULL,             -- JSON: StageDefinitions (Zod-validated)
  prompt_overrides TEXT,                       -- JSON: PromptOverrides (keyed by agentRoleId)
  tags TEXT,                                   -- JSON array of string tags
  match_criteria TEXT,                         -- JSON: MatchCriteria (Zod-validated)
  usage_count INTEGER NOT NULL DEFAULT 0,
  avg_rating REAL,
  parent_template_id TEXT,                     -- nullable, references row_id for lineage
  is_latest BOOLEAN NOT NULL DEFAULT true,     -- denormalized flag for fast lookups
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'system',
  UNIQUE(id, version)
);

CREATE INDEX idx_wf_templates_id ON workflow_templates(id);
CREATE INDEX idx_wf_templates_latest ON workflow_templates(id, is_latest) WHERE is_latest = true;
CREATE INDEX idx_wf_templates_tags ON workflow_templates(tags);
CREATE INDEX idx_wf_templates_ticket_type ON workflow_templates(ticket_type);
```

**Versioning mechanics:**
- When creating a new version: INSERT with `version = max(version) + 1` for that `id`, set `is_latest = true`, and UPDATE all previous rows for that `id` to `is_latest = false` — wrapped in a transaction.
- Running epics pin to a specific `row_id` — immutable reference.
- `is_latest` denormalized flag avoids expensive MAX(version) queries on every template lookup.

#### `workflow_agent_roles` table

> We pick the **building blocks** approach. The `system_prompt` freeform field is replaced with a structured `prompt_block` JSON column that stores a `PromptBlock` object (preamble + toolAccessTier + constraints + completionInstructions). The prompt composer assembles the final prompt from these blocks. This means no freeform prompt injection via the skill — only structured, validatable components.

```sql
CREATE TABLE workflow_agent_roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt_block TEXT NOT NULL,                  -- JSON: PromptBlock (Zod-validated)
  tools_allowed TEXT,                          -- JSON array of tool/category names
  capability_tier TEXT NOT NULL DEFAULT 'advisory'
    CHECK(capability_tier IN ('advisory', 'code-modification', 'infrastructure')),
  created_by_template_row_id TEXT,             -- which template version first created this
  reusable BOOLEAN NOT NULL DEFAULT true,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_wf_agent_roles_tier ON workflow_agent_roles(capability_tier);
CREATE INDEX idx_wf_agent_roles_reusable ON workflow_agent_roles(reusable) WHERE reusable = true;
```

#### `workflow_reviews` table

```sql
CREATE TABLE workflow_reviews (
  id TEXT PRIMARY KEY,
  template_row_id TEXT NOT NULL,               -- references workflow_templates.row_id
  epic_id TEXT NOT NULL REFERENCES workflow_tickets(id),
  structured_findings TEXT NOT NULL,           -- JSON: ReviewFinding[]
  suggested_changes TEXT,                      -- JSON: SuggestedChange[]
  per_state_timing TEXT,                       -- JSON: { [state: string]: { entered_at, exited_at, duration_ms } }
  human_approved BOOLEAN,
  applied_as_version INTEGER,                  -- set if changes were approved and minted
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE INDEX idx_wf_reviews_template ON workflow_reviews(template_row_id);
CREATE INDEX idx_wf_reviews_epic ON workflow_reviews(epic_id);
```

#### Existing table changes

Add columns to `workflow_tickets`:

```sql
ALTER TABLE workflow_tickets ADD COLUMN workflow_template_row_id TEXT;
ALTER TABLE workflow_tickets ADD COLUMN workflow_template_version INTEGER;
```

These bind each ticket to its governing template version. Nullable for backward compat during the transition period (existing rows won't have them).

### 2B. Repository Interfaces

> **[Architecture — B3 Fix]**: All new repository interfaces live in `src/application/workflow/`. The existing `WorkflowTicketRepository`, `WorkflowTransitionRepository`, and `TicketDependencyRepository` from `src/domain/workflow/repository.ts` will be moved to `src/application/workflow/ticket-repository.ts` during Phase 3D. No domain-layer file will import from infrastructure. Infrastructure implementations in `src/infrastructure/persistence/` import from application-layer interfaces only.

Create `src/application/workflow/template-repository.ts`:

```typescript
export interface WorkflowTemplateRow {
  rowId: string;
  id: string;
  version: number;
  name: string;
  description: string;
  ticketType: 'epic' | 'task';
  stageDefinitions: StageDefinition[];  // parsed from JSON
  promptOverrides?: PromptOverrides;    // parsed from JSON, keyed by agentRoleId
  tags?: string[];
  matchCriteria?: MatchCriteria;
  usageCount: number;
  avgRating?: number;
  parentTemplateId?: string;
  isLatest: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface WorkflowTemplateRepository {
  findByRowId(rowId: string): WorkflowTemplateRow | null;
  findLatest(id: string): WorkflowTemplateRow | null;
  findByIdAndVersion(id: string, version: number): WorkflowTemplateRow | null;
  findAllLatest(filters?: { ticketType?: string; tags?: string[] }): WorkflowTemplateRow[];
  create(template: Omit<WorkflowTemplateRow, 'rowId' | 'createdAt' | 'updatedAt' | 'isLatest'>): WorkflowTemplateRow;
  createNewVersion(id: string, changes: Partial<WorkflowTemplateRow>): WorkflowTemplateRow;
  incrementUsage(rowId: string): void;
  updateRating(rowId: string, rating: number): void;
}
```

Create `src/application/workflow/agent-role-repository.ts`:

```typescript
export interface AgentRoleRow {
  id: string;
  name: string;
  description: string;
  promptBlock: PromptBlock;  // parsed from JSON
  toolsAllowed?: string[];
  capabilityTier: CapabilityTier;
  createdByTemplateRowId?: string;
  reusable: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRoleRepository {
  findById(id: string): AgentRoleRow | null;
  findAll(filters?: { capabilityTier?: string; reusable?: boolean }): AgentRoleRow[];
  findByName(name: string): AgentRoleRow | null;
  create(role: Omit<AgentRoleRow, 'createdAt' | 'updatedAt' | 'usageCount'>): AgentRoleRow;
  update(id: string, changes: Partial<AgentRoleRow>): AgentRoleRow | null;
  incrementUsage(id: string): void;
}
```

Create `src/application/workflow/review-repository.ts`:

```typescript
export interface WorkflowReviewRow {
  id: string;
  templateRowId: string;
  epicId: string;
  structuredFindings: ReviewFinding[];
  suggestedChanges?: SuggestedChange[];
  perStateTiming?: Record<string, { enteredAt: string; exitedAt: string; durationMs: number }>;
  humanApproved?: boolean;
  appliedAsVersion?: number;
  createdAt: string;
  reviewedAt?: string;
}

export interface WorkflowReviewRepository {
  findById(id: string): WorkflowReviewRow | null;
  findByTemplate(templateRowId: string): WorkflowReviewRow[];
  findByEpic(epicId: string): WorkflowReviewRow | null;
  create(review: Omit<WorkflowReviewRow, 'id' | 'createdAt'>): WorkflowReviewRow;
  update(id: string, changes: Partial<WorkflowReviewRow>): WorkflowReviewRow | null;
}
```

### 2C. SQLite Implementations

Create `src/infrastructure/persistence/workflow-template-repository.ts` — implements `WorkflowTemplateRepository`. All JSON columns are parsed through Zod schemas on read. Version creation uses a transaction to atomically set `is_latest = false` on old rows and `is_latest = true` on the new one.

Create `src/infrastructure/persistence/workflow-agent-role-repository.ts` — implements `AgentRoleRepository`.

Create `src/infrastructure/persistence/workflow-review-repository.ts` — implements `WorkflowReviewRepository`.

**Files created/modified in Phase 2:**
- `src/infrastructure/persistence/database.ts` (new migration blocks)
- `src/application/workflow/template-repository.ts`
- `src/application/workflow/agent-role-repository.ts`
- `src/application/workflow/review-repository.ts`
- `src/infrastructure/persistence/workflow-template-repository.ts`
- `src/infrastructure/persistence/workflow-agent-role-repository.ts`
- `src/infrastructure/persistence/workflow-review-repository.ts`

---

## Phase 3: Engine Refactor — Dynamic Topology Loader

### 3A. Topology Loader

Create `src/application/workflow/topology-loader.ts`:

Responsible for loading the stage definitions for a given ticket from the DB. Two paths:
1. **Ticket has `workflow_template_row_id`** → load from `workflow_templates` by `row_id`
2. **Ticket has no template** → fallback: treat the ticket as stuck, surface error

```typescript
export interface TopologyLoader {
  /** Load stage definitions for a ticket, resolving its pinned template version */
  loadForTicket(ticket: WorkflowTicket): StageDefinition[];
  /** Load stage definitions directly from a template row_id */
  loadByTemplateRowId(rowId: string): StageDefinition[];
  /** Load the full template row (for prompt overrides, etc.) */
  loadTemplateForTicket(ticket: WorkflowTicket): WorkflowTemplateRow | null;
}
```

The loader caches parsed+validated stage definitions in an LRU map (keyed by `row_id`) to avoid repeated JSON parsing and Zod validation on every transition.

### 3B. Engine Refactor

Modify `src/application/workflow/engine.ts`:

**Key changes:**
- Remove all imports from `@domain/workflow/state-machine.js` — these static helpers go away
- Inject `TopologyLoader` into `WorkflowEngineDeps`
- Every call to `isValidTransition`, `isHumanGate`, `getStageDefinition`, `isTerminal`, `isAgentActionable` now loads the topology dynamically via the loader and uses the runtime helper functions from `types.ts`
- `WorkflowState` type in function signatures becomes `string` — all validation is runtime via Zod schemas and topology lookup

> **[Runtime Recursion Guard]**: Add a `depth` parameter to `applyTransition` with a hard cap.

```typescript
const MAX_AUTO_TRANSITION_DEPTH = 10;

function applyTransition(
  ticket: WorkflowTicket,
  toState: string,
  actor: TransitionActor,
  comment?: string,
  data?: Record<string, unknown>,
  _depth: number = 0,                    // <-- new parameter
): WorkflowTicket {
  if (_depth >= MAX_AUTO_TRANSITION_DEPTH) {
    throw new Error(
      `Auto-transition depth limit (${MAX_AUTO_TRANSITION_DEPTH}) exceeded for ticket ${ticket.id}. ` +
      `Chain: reached state '${toState}' at depth ${_depth}. Halting to prevent stack overflow.`
    );
  }

  const stages = topologyLoader.loadForTicket(ticket);
  // ... existing transition logic using runtime helpers ...

  // Auto-transition recursion with depth tracking
  const stage = getStageDefinition(stages, updated.state);
  if (stage) {
    const autoTarget = stage.validTransitions.find(t => t.trigger === 'auto');
    if (autoTarget) {
      return applyTransition(updated, autoTarget.to, autoActor, undefined, undefined, _depth + 1);
    }
  }

  return updated;
}
```

The existing circuit breaker for plan-critique → planning loops is preserved but generalized: instead of hardcoding state names, it reads the iteration count from stateData and checks against a configurable max.

> **[B4 Fix — onTaskCompleted parent-epic dispatch gap]**: The current `onTaskCompleted()` transitions the parent epic via `applyTransition()` directly, bypassing the dispatch coordinator. This means no agent dispatch happens for the epic's new state (e.g., `integration-review`).

**Fix**: Inject the `DispatchCoordinator` into the engine (or use a callback pattern to avoid circular deps), so that when `onTaskCompleted` advances a parent epic, the epic transition flows through the coordinator for proper dispatch.

Concrete approach — **callback pattern** to avoid circular dependency between engine and coordinator:

```typescript
export interface WorkflowEngineDeps {
  tickets: WorkflowTicketRepository;
  transitions: WorkflowTransitionRepository;
  dependencies: TicketDependencyRepository;
  topologyLoader: TopologyLoader;
  /** Called when a parent epic transitions due to task completion.
   *  The coordinator sets this after construction to wire dispatch. */
  onEpicAdvanced?: (ticket: WorkflowTicket) => Promise<void>;
}
```

In `onTaskCompleted`, after `applyTransition` advances the epic:

```typescript
onTaskCompleted(ticketId: WorkflowTicketId): void {
  const ticket = requireTicket(ticketId);
  const stages = topologyLoader.loadForTicket(ticket);

  // Only process tasks that reached a terminal state
  if (!isTerminal(stages, ticket.state)) return;

  // Resolve dependencies
  const unblockedIds = resolver.resolveAndUnblock(ticketId);

  // Auto-transition unblocked tasks
  for (const unblockedId of unblockedIds) {
    const blocked = tickets.findById(unblockedId);
    if (blocked) {
      const blockedStages = topologyLoader.loadForTicket(blocked);
      const blockedStage = getStageDefinition(blockedStages, blocked.state);
      // Find the 'all-deps-resolved' transition dynamically
      const unblockTransition = blockedStage?.validTransitions.find(
        t => t.trigger === 'all-deps-resolved'
      );
      if (unblockTransition) {
        const systemActor = { type: 'system' as const, reason: 'All dependencies resolved' };
        applyTransition(blocked, unblockTransition.to, systemActor);
      }
    }
  }

  // Check if parent epic should advance
  if (ticket.parentId) {
    const epic = tickets.findById(ticket.parentId);
    if (epic) {
      const epicStages = topologyLoader.loadForTicket(epic);
      const epicStage = getStageDefinition(epicStages, epic.state);
      // Find the 'all-tasks-done' transition dynamically
      const advanceTransition = epicStage?.validTransitions.find(
        t => t.trigger === 'all-tasks-done'
      );
      if (advanceTransition && resolver.allChildrenDone(epic.id)) {
        const epicActor = { type: 'system' as const, reason: 'All child tasks completed' };
        const advancedEpic = applyTransition(epic, advanceTransition.to, epicActor);
        // Route through coordinator for dispatch (B4 fix)
        if (deps.onEpicAdvanced) {
          deps.onEpicAdvanced(advancedEpic).catch(err => {
            console.error(`[workflow] Failed to dispatch for advanced epic ${epic.id}:`, err);
          });
        }
      }
    }
  }
}
```

The coordinator wires this callback during construction:

```typescript
// In createDispatchCoordinator():
engine.onEpicAdvanced = async (epic) => {
  await dispatchIfNeeded(epic);
};
// (or via a setter method on the engine)
```

### 3C. Update Foundation Types

Modify `src/foundation/types.ts`:

- **Remove**: `EpicState`, `TaskState`, `WorkflowState` union types, `HumanGateState`, `AgentRole` union type
- **Replace with**: `type WorkflowState = string;` and `type AgentRoleId = string;`
- **Keep**: `WorkflowTicket`, `WorkflowTransition`, `TransitionActor`, `TicketDependency` — these are unchanged structurally
- **Remove**: The old `StageDefinition` interface (replaced by the Zod-derived type in `application/workflow/types.ts`)
- **Remove**: All the state-specific data interfaces (`TriagingData`, `PlanningData`, `NeedsInputData`, `PlanCritiqueData`, `SplittingData`, `EpicInProgressData`, `IntegrationReviewData`, `FinalReviewData`, `CodeReviewData`, `ChangesRequestedData`, `ExecutionData`) — these become freeform since each workflow defines its own states. The `stateData` field remains `Record<string, unknown>`.
- **Add**: `workflowTemplateRowId?: string` and `workflowTemplateVersion?: number` to `WorkflowTicket`

The `WorkflowTicket.assignedAgentRole` field changes type from `AgentRole` (union) to `string`.
The `WorkflowTicket.state` field changes type from `WorkflowState` (union) to `string`.
The `WorkflowTransition.fromState` and `toState` change from `WorkflowState` to `string`.

### 3D. Delete Old Files and Move Repository Interfaces

> **[B3 Fix — Architecture layering]**: The existing repository interfaces live in `src/domain/workflow/repository.ts`. Per human answer #1 and the architecture rule, we move them to `src/application/workflow/ticket-repository.ts`. This ensures no domain-layer code remains that would create an import violation.

Steps:
1. Create `src/application/workflow/ticket-repository.ts` — copy `WorkflowTicketRepository`, `WorkflowTransitionRepository`, `TicketDependencyRepository` and their associated types from `src/domain/workflow/repository.ts`
2. Update `WorkflowTicketUpdate` to include the new `workflowTemplateRowId` and `workflowTemplateVersion` fields
3. Update ALL imports across the codebase that reference `@domain/workflow/repository` to use `@application/workflow/ticket-repository.js`
4. **Delete** `src/domain/workflow/state-machine.ts` — replaced by topology loader + DB
5. **Delete** `src/domain/workflow/templates.ts` — replaced by DB-stored templates (if this file exists)
6. **Delete** `src/domain/workflow/repository.ts` — moved to application layer
7. **Delete** `src/domain/workflow/` directory entirely

Files that import from `@domain/workflow/repository` (must all be updated):
- `src/application/workflow/engine.ts`
- `src/application/workflow/dispatch-coordinator.ts`
- `src/application/workflow/agent-dispatcher.ts`
- `src/application/workflow/execution-dispatcher.ts`
- `src/application/workflow/startup-recovery.ts`
- `src/application/workflow/dependency-resolver.ts`
- `src/infrastructure/persistence/workflow-repository.ts`
- `src/server/api.ts` (if it imports repository types)

### 3E. Prompt Composer Refactor

Modify `src/application/workflow/prompt-composer.ts`:

The current system is a giant `switch` over hardcoded `AgentRole` values. Replace with data-driven composition:

> **[S2 Fix — Wire promptOverrides]**: The composer now accepts the template's `promptOverrides` and applies them. Priority order: stage.promptOverride > template.promptOverrides[agentRoleId] > agentRole.promptBlock.preamble.

```typescript
export function composeWorkflowPrompt(
  agentRole: AgentRoleRow,
  ticket: WorkflowTicket,
  stage: StageDefinition,
  templateOverrides?: PromptOverrides,
  context?: PromptContext,
): string {
  const parts: string[] = [];

  // 1. Preamble from the agent role's prompt block
  parts.push(agentRole.promptBlock.preamble);

  // 2. Template-level prompt override for this role (if defined)
  if (templateOverrides?.[agentRole.id]) {
    parts.push(templateOverrides[agentRole.id]);
  }

  // 3. Per-stage prompt override (highest specificity, overrides template-level)
  if (stage.promptOverride) {
    parts.push(stage.promptOverride);
  }

  // 4. Ticket context (title, description)
  parts.push(`## Ticket\n\n**${ticket.title}**\n\n${ticket.description}`);

  // 5. State data context (plan drafts, findings, answers, etc.)
  // Dynamically assembled from stateData keys — no hardcoded structure
  if (ticket.stateData && Object.keys(ticket.stateData).length > 0) {
    parts.push(formatStateData(ticket.stateData));
  }

  // 6. Constraints from the agent role
  if (agentRole.promptBlock.constraints.length > 0) {
    parts.push('## Constraints\n\n' + agentRole.promptBlock.constraints.map(c => `- ${c}`).join('\n'));
  }

  // 7. Completion instructions
  parts.push('## Completion\n\n' + agentRole.promptBlock.completionInstructions);

  // 8. Track context and summary (unchanged from current)
  if (context?.trackContext) {
    parts.push(`## Track Context\n\n${context.trackContext}`);
  }
  if (context?.summary) {
    parts.push(`## Current Status\n\n${context.summary}`);
  }

  return parts.join('\n\n---\n\n');
}
```

### 3F. Agent Dispatcher Refactor

Modify `src/application/workflow/agent-dispatcher.ts`:

- Load stage definitions from topology loader instead of `getStageDefinition` static import
- Load agent role from `AgentRoleRepository` using `stage.agentRoleId`
- Load template (via `topologyLoader.loadTemplateForTicket`) to pass `promptOverrides` to the composer
- Use refactored prompt composer with template overrides
- Everything else (session creation, stateData updates) stays the same

### 3G. Comprehensive Hardcoded State Replacement

> **[B1 Fix]**: Every file that contains hardcoded state string literals must be updated. Here is the complete inventory:

| File | Location | Hardcoded States | Replacement |
|------|----------|-----------------|-------------|
| `engine.ts` | `onTaskCompleted()` L219 | `'done'` | Check `isTerminal(stages, ticket.state)` via topology loader |
| `engine.ts` | `onTaskCompleted()` L228-229 | `'blocked'`, `'ready'` | Find `all-deps-resolved` transition dynamically from stage definition |
| `engine.ts` | `onTaskCompleted()` L236 | `'in-progress'` | Find `all-tasks-done` transition dynamically from stage definition |
| `engine.ts` | `onTaskCompleted()` L242 | `'integration-review'` | Use transition target from `all-tasks-done` trigger, not hardcoded state name |
| `engine.ts` | `createEpic()` L253 | `'idea'` | Entry state = first stage in template's `stageDefinitions` array |
| `engine.ts` | `createEpic()` L262 | `'triaging'` | Follow `auto` transition from entry state dynamically |
| `engine.ts` | `createTask()` L267 | `'blocked'`, `'ready'` | Use task template's entry state; if task has deps, use the stage with `all-deps-resolved` trigger as initial |
| `engine.ts` | `createEpicAtPlanReview()` L295 | `'plan-review'` | Accept target state as parameter (or find by `humanGate: true` + matching semanticRole) |
| `engine.ts` | `applyTransition()` L111 | `'plan-critique'`, `'planning'`, `'plan-review'` | Generalize: if iteration count in stateData exceeds max, find nearest human gate via topology |
| `dispatch-coordinator.ts` | `dispatchIfNeeded()` L61 | `'executing'` | Check `stage.semanticRole === 'processing'` AND stage has `execution-complete`/`execution-failed` triggers (execution stage pattern) |
| `dispatch-coordinator.ts` | `dispatchIfNeeded()` L69 | `'execution-failed'` | Use the target from the `execution-failed` trigger on the current stage |
| `dispatch-coordinator.ts` | `transitionWithDispatch()` L95 | `'done'` | Check `isTerminal(stages, toState)` to trigger `onTaskCompleted` |
| `execution-dispatcher.ts` | `approveWithExecution()` L115 | `'executing'` | Check stage semanticRole or whether stage has `execution-complete` trigger |
| `execution-dispatcher.ts` | `approveWithExecution()` L128 | `'execution-failed'` | Find transition with `execution-failed` trigger from current stage |
| `execution-dispatcher.ts` | `dispatch()` L145 | `'executing'` | Same as L115 — check stage pattern |
| `execution-dispatcher.ts` | `buildInitialPrompt()` L232 | `'integration-review'` | Read target from `execution-complete` trigger on the current stage |
| `execution-dispatcher.ts` | `buildInitialPrompt()` L233 | `'execution-failed'` | Read target from `execution-failed` trigger on the current stage |
| `startup-recovery.ts` | L11, L54-56 | `isAgentActionable`, `isTerminal` static imports; `'executing'` | Import runtime helpers from `types.ts`; use topology loader for stage lookup |
| `agent-dispatcher.ts` | L20-21, L157-161 | `getStageDefinition` static import; `'executing'` | Use topology loader; check stage pattern instead of string literal |
| `EpicList.tsx` | L20 | `TERMINAL_STATES = new Set(['merged', 'cancelled'])` | Compute from API: stages where `semanticRole === 'terminal'` |
| `EpicList.tsx` | L21 | `HUMAN_REVIEW_STATES = new Set(['spec-review', 'plan-review', 'final-review'])` | Compute from API: stages where `humanGate === true` |
| `EpicList.tsx` | L22 | `DONE_STATES = new Set(['merged', 'approved'])` | Compute from API: stages where `semanticRole === 'terminal'` and state is not `cancelled` |
| `HumanGatePanel.tsx` | L70-71 | `isHumanGate()` hardcoded string comparison | Fetch stage definitions from API; check `stage.humanGate === true` |
| `state-machine.ts` (domain) | L15-292, L325-326 | `EPIC_STAGES`, `TASK_STAGES`, `isHumanGate` | Entire file deleted |

**Strategy for each category:**
- **State string comparisons in engine/coordinator/dispatchers**: Replace with trigger-based lookups on the stage definition. Instead of `if (state === 'executing')`, check `if (stageHasTrigger(stage, 'execution-complete'))`.
- **State sets in UI components**: Replace with `semanticRole` from the stage definition (served via API). The API response for ticket lists includes `semanticRole` for the current state.
- **Type guard functions**: The static `isHumanGate()`, `isTerminal()`, `isAgentActionable()` are replaced by runtime helpers in `types.ts` that take the stage definitions array as a parameter.

### 3H. Task Lifecycle Under Dynamic System

> **[B2 Fix]**: The old system hardcodes task states (`blocked`, `ready`, `in-progress`, `code-review`, `changes-requested`, `done`, `cancelled`) in `TASK_STAGES`. The dynamic system must handle tasks through the same template mechanism as epics.

#### Task Template Binding

Tasks are bound to templates via the same `workflow_template_row_id` column as epics, but the template is provided by the parent epic's template or by the splitter agent:

1. **Template `ticket_type` field**: Templates declare `ticket_type: 'epic' | 'task'`. Task templates define the task lifecycle graph (e.g., blocked → ready → in-progress → code-review → done). Epic templates define the epic lifecycle.

2. **Task template selection flow**:
   - When the workflow selection skill creates an epic template, it also specifies a **companion task template ID** in the epic template's stage definitions. Specifically, the stage that has an `all-tasks-done` trigger (the "in-progress" stage in the old system) carries a `taskTemplateId` metadata field in its `promptOverride` or in the template's `promptOverrides` under a reserved key `_taskTemplate`.
   - Alternatively, the epic template's `promptOverrides` includes a `_taskTemplateId: string` entry that the splitter agent and `createTask()` read.

3. **`createTask()` refactor**:

```typescript
createTask(data: {
  title: string;
  description: string;
  parentId: WorkflowTicketId;
  provider?: SessionProvider;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  dependsOn?: WorkflowTicketId[];
  /** Explicit task template. If omitted, inherited from parent epic. */
  workflowTemplateRowId?: string;
}): WorkflowTicket {
  // Resolve task template
  const templateRowId = data.workflowTemplateRowId
    ?? resolveTaskTemplate(data.parentId);

  if (!templateRowId) {
    throw new Error(
      `No task template found for parent epic ${data.parentId}. ` +
      `The epic template must specify a companion task template.`
    );
  }

  const stages = topologyLoader.loadByTemplateRowId(templateRowId);
  const hasDeps = data.dependsOn && data.dependsOn.length > 0;

  // Determine initial state from the template:
  // - If task has dependencies: find the stage with 'all-deps-resolved' trigger (waiting state)
  // - If no dependencies: use the entry state (first in array)
  let initialState: string;
  if (hasDeps) {
    const waitingStage = stages.find(s =>
      s.validTransitions.some(t => t.trigger === 'all-deps-resolved')
    );
    initialState = waitingStage?.state ?? stages[0].state;
  } else {
    initialState = stages[0].state;
  }

  const task = tickets.create({
    type: 'task',
    title: data.title,
    description: data.description,
    state: initialState,
    parentId: data.parentId,
    provider: data.provider || 'claude',
    priority: data.priority || 'medium',
    sortOrder: 0,
    workflowTemplateRowId: templateRowId,
    workflowTemplateVersion: /* resolved from template row */,
  });

  // Create dependency records
  if (data.dependsOn) {
    for (const depId of data.dependsOn) {
      dependencies.create(task.id, depId);
    }
  }

  // Follow auto-transitions from entry state (just like createEpic)
  const entryStage = getStageDefinition(stages, task.state);
  const autoTarget = entryStage?.validTransitions.find(t => t.trigger === 'auto');
  if (autoTarget) {
    return applyTransition(task, autoTarget.to,
      { type: 'system', reason: 'Auto-transition from entry state' });
  }

  return task;
}
```

4. **`resolveTaskTemplate()` helper**:

```typescript
function resolveTaskTemplate(parentId: WorkflowTicketId): string | undefined {
  const parent = tickets.findById(parentId);
  if (!parent?.workflowTemplateRowId) return undefined;

  const parentTemplate = topologyLoader.loadTemplateForTicket(parent);
  if (!parentTemplate) return undefined;

  // Look for companion task template reference
  const taskTemplateId = parentTemplate.promptOverrides?.['_taskTemplateId'];
  if (taskTemplateId) {
    // Resolve to a row_id from the latest version
    const taskTemplate = templateRepo.findLatest(taskTemplateId);
    return taskTemplate?.rowId;
  }

  return undefined;
}
```

5. **Splitter agent awareness**: The splitter agent's prompt (composed from its agent role's prompt block) includes:
   - The task template ID from the parent epic template
   - Instructions to call `workshop_create_task` with `workflowTemplateRowId` parameter
   - If no task template is specified in the epic template, the splitter skill can create one (same as the workflow selection skill creates epic templates) and get human approval

6. **Review skill covers tasks**: The post-implementation review skill runs on epic completion (unchanged), but its analysis includes per-task performance metrics aggregated from the task-level transition audit logs. Task template suggestions (e.g., "add a lint check stage") are included in the review's `suggested_changes`.

**Files created/modified in Phase 3:**
- `src/application/workflow/topology-loader.ts` (new)
- `src/application/workflow/ticket-repository.ts` (new — moved from domain)
- `src/application/workflow/engine.ts` (major refactor)
- `src/foundation/types.ts` (remove union types, add template fields)
- `src/domain/workflow/state-machine.ts` (delete)
- `src/domain/workflow/templates.ts` (delete)
- `src/domain/workflow/repository.ts` (delete — moved)
- `src/application/workflow/prompt-composer.ts` (major refactor)
- `src/application/workflow/agent-dispatcher.ts` (refactor)
- `src/application/workflow/execution-dispatcher.ts` (refactor)
- `src/application/workflow/startup-recovery.ts` (refactor)
- `src/application/workflow/dispatch-coordinator.ts` (refactor + B4 callback wiring)
- `src/application/workflow/dependency-resolver.ts` (import updates)

---

## Phase 4: Workflow Selection/Creation Skill

A Claude Code skill that runs when a new epic is created. It receives the epic context, queries the template registry, and either selects an existing template or designs a new one.

### 4A. Skill Definition

Create `skills/workflow-select/SKILL.md`:

```markdown
# Workflow Selection Skill

Select or create a workflow template for a new epic.
Tagged: workshop.

## Trigger
When a new epic is created and needs a workflow assigned.

## Behavior
1. Read the epic description and context
2. Query the template registry via workshop_list_workflow_templates MCP tool
3. Query the agent role registry via workshop_list_agent_roles MCP tool
4. Either select the best match or design a new workflow template
5. If designing a new template, also design a companion task template
6. Validate the workflow graph (the skill itself calls the validation endpoint)
7. Submit for human approval via workshop_propose_workflow MCP tool
```

### 4B. New MCP Endpoints

Add to `src/mcp/server.ts` and `src/server/api.ts`:

**Read endpoints (for skill to query):**
- `workshop_list_workflow_templates` — returns all latest templates with tags, match criteria, and ticket_type filter
- `workshop_list_agent_roles` — returns all reusable agent roles with capability tiers
- `workshop_validate_workflow` — accepts a stage definitions JSON, runs graph validator, returns result

**Write endpoints (for skill to propose):**
- `workshop_propose_workflow` — accepts: epic template + task template + agent role definitions + epic ID + rationale. Stores a pending proposal in the ticket's stateData. Does NOT auto-apply — human must approve via the Workflow Assignment Panel.

**Human approval endpoint (existing pattern):**
- `workshop_approve_workflow_assignment` — takes the pending proposal, persists the template (and any new agent roles), binds the ticket, and transitions the epic into its entry state.

### 4C. Skill Logic (what the LLM does)

The skill prompt instructs the LLM to:

1. **Score existing templates** against the epic using tag overlap + description similarity
2. **Select if good match** (>= 70% tag overlap and description alignment)
3. **Design new if no match** — create stage definitions for BOTH epic and task templates, specify agent roles (reuse existing where possible, propose new ones where needed)
4. **Lightweight path** — for trivial work (single-file fix, documentation update), create a 2-3 state pass-through (e.g., `ready → in-progress → done`) rather than a full pipeline. In this case the epic template can skip the splitting stage and go straight to execution.
5. **Always include at least one human gate** for non-trivial workflows (enforced by graph validator anyway)
6. **New agent roles** above `advisory` tier are flagged for human approval in the proposal
7. **Must complete in a single turn** — if the skill cannot decide, it falls back to proposing a minimal workflow (entry → human-gate → execute → review → done)
8. **Companion task template** — every epic template that includes a splitting/in-progress phase must specify a companion task template. The selection skill creates both together.

### 4D. Prompt Injection Defenses

The workflow selection skill operates on user-provided epic descriptions, which is a prompt injection surface. Defenses:

1. **Graph validator is the hard gate** — regardless of what the LLM generates, the graph validator enforces:
   - At least one human gate state for workflows with > 2 states
   - Agent roles above `advisory` must have a `human-approve` transition on an inbound path
   - No self-referencing auto-transition loops
   - All states reachable, all terminal states valid

2. **Capability tier enforcement in engine** — even if a malicious template somehow gets persisted, the engine checks the agent role's capability tier at dispatch time and requires human approval for `code-modification` and `infrastructure` tiers if no prior human gate approved this execution path

3. **Prompt block validation** — agent role prompts are assembled from structured blocks (not freeform). The `preamble` field is capped at 5000 chars and the `constraints` array enforces standard guardrails. The prompt composer always appends immutable safety constraints regardless of what the prompt block says.

4. **Human approval gate** — the proposed workflow is always shown to the human before it's activated. The Workflow Assignment Panel displays the full template, all agent roles with tier badges, and flags any new roles. Human must click "Approve & Start".

**Files created/modified in Phase 4:**
- `skills/workflow-select/SKILL.md` (new)
- `src/mcp/server.ts` (new MCP tools)
- `src/server/api.ts` (new HTTP endpoints)

---

## Phase 5: Post-Implementation Review Skill

### 5A. Skill Definition

Create `skills/workflow-review/SKILL.md`:

The review skill runs asynchronously after an epic reaches a terminal state (`merged` or `cancelled` — determined dynamically by checking `semanticRole === 'terminal'`).

### 5B. Trigger Mechanism

In the engine's `applyTransition`, when a ticket reaches a terminal state:
1. Check if the ticket has a `workflowTemplateRowId`
2. If yes, fire-and-forget: create a background session with the review skill prompt
3. The skill reads the transition audit log, computes per-state timing, identifies patterns
4. Creates a `workflow_review` record with findings and suggested changes
5. On failure/timeout: log a warning and move on — review is advisory, never blocks the epic

### 5C. Review Skill Capabilities

The skill:
- Queries `workshop_list_workflow_transitions(epicId)` — full audit trail
- Computes wall-clock time per state from transition timestamps
- Identifies retry loops (same from→to transition appearing > N times)
- Flags human interventions (reject transitions)
- Proposes template changes as a JSON diff — **for BOTH epic and task templates** if the epic had child tasks
- Never auto-applies — the diff is stored in `workflow_reviews.suggested_changes`
- Also checks the template library for merge candidates (high similarity, low differentiation) and flags unused templates (zero usage in last N days)

### 5D. Applying Review Suggestions

UI shows the review in a diff view. Human can:
- **Accept** — system creates a new template version with the suggested changes, validates via graph validator, and persists if valid
- **Reject** — review is archived
- **Modify** — human edits the suggestion, then accept

Uses optimistic concurrency: the review records the `template_version` it was based on. When applying, if the template has been versioned since, the system warns about a conflict and asks the human to reconcile.

**Files created/modified in Phase 5:**
- `skills/workflow-review/SKILL.md` (new)
- Engine: add terminal-state hook in `applyTransition`

---

## Phase 6: UI Surfaces

### 6A. Workflow Assignment Panel

New component: `src/ui/workflow/WorkflowAssignmentPanel.tsx`

Appears after epic creation (when the epic has a pending workflow proposal in stateData). Shows:
- Selected/proposed template name and description
- Rationale from the selection skill
- Agent roster with capability tier badges (color-coded: green=advisory, yellow=code-mod, red=infra)
- New agent roles flagged with a "NEW" badge
- Companion task template (if proposed)
- "Approve & Start" button
- "Override" dropdown to pick a different template from the library

### 6B. Template Library Browser

New component: `src/ui/workflow/TemplateLibrary.tsx`

Card-based layout. Each card shows: name, description, ticket type (epic/task), usage count, last-used date, tag pills, average rating. Click opens a detail view with:
- Full SVG state diagram (reuse StateDiagram component with dynamic data)
- Agent roles used
- Version history
- Reviews history

Filter by tags, ticket type, search by name/description.

### 6C. StateDiagram Updates

Modify `src/ui/workflow/StateDiagram.tsx`:

Currently imports `EPIC_STAGES`/`TASK_STAGES` directly. Refactor to accept stage definitions as a prop:

```typescript
interface StateDiagramProps {
  stages: StageDefinition[];
  currentState?: string;
  transitions?: WorkflowTransition[];  // for highlighting completed paths
}
```

The component fetches stage definitions from the API for the ticket's pinned template version.

### 6D. Live Execution Progress

Update `src/ui/workflow/EpicDetail.tsx`:

The current progress display is hardcoded to the static state list. Refactor to use the dynamic stage definitions from the ticket's template. Show:
- Current state highlighted
- Completed states marked with checkmarks
- Per-state timing (from transition audit log)
- Agent sessions linked to each state

### 6E. Review Diff View

New component: `src/ui/workflow/ReviewDiffView.tsx`

Shows before/after template changes proposed by the review skill. Uses a simple diff display — left side shows current template stages, right side shows proposed changes. Accept/reject/modify actions.

### 6F. Empty State

When a new epic has no template yet (skill is running), show:
- "Designing a custom workflow for this epic..." with a spinner
- Brief explanation that the system is analyzing the epic to create a tailored workflow
- Not "No matching template found" — that's a failure state, not a loading state

### 6G. Dynamic State Filtering in EpicList

> **[S3 Fix]**: The API response for ticket listings includes a `semanticRole` field for the ticket's current state. This replaces the hardcoded `TERMINAL_STATES`, `HUMAN_REVIEW_STATES`, `DONE_STATES` sets in `EpicList.tsx`.

The API endpoint `GET /api/workflow/tickets` adds to each ticket response:
```typescript
{
  ...ticket,
  currentStateSemanticRole: 'processing' | 'human-gate' | 'terminal' | 'error' | 'waiting' | 'entry',
  currentStateHumanGate: boolean,
}
```

`EpicList.tsx` filters use these fields:
- "Active" tab: `semanticRole` not in `['terminal']`
- "Human Review" tab: `currentStateHumanGate === true`
- "Done" tab: `semanticRole === 'terminal'`

**Files created/modified in Phase 6:**
- `src/ui/workflow/WorkflowAssignmentPanel.tsx` (new)
- `src/ui/workflow/TemplateLibrary.tsx` (new)
- `src/ui/workflow/ReviewDiffView.tsx` (new)
- `src/ui/workflow/StateDiagram.tsx` (refactor to accept props)
- `src/ui/workflow/EpicDetail.tsx` (refactor for dynamic stages)
- `src/ui/workflow/EpicList.tsx` (replace hardcoded state sets with semanticRole)
- `src/ui/workflow/WorkflowPage.tsx` (add template library tab)
- `src/ui/workflow/HumanGatePanel.tsx` (use API for gate detection)
- `src/ui/workflow/WorkflowStateIndicator.tsx` (data-driven colors via semanticRole)

---

## Phase 7: Cleanup

### 7A. Verify Domain Layer Removal

Confirm that `src/domain/workflow/` is fully deleted (done in Phase 3D). Verify no remaining imports reference `@domain/workflow/`.

### 7B. Type Cleanup

- Remove all dead `EpicState`, `TaskState`, `HumanGateState`, `AgentRole` union types from `src/foundation/types.ts`
- Remove all state-specific data interfaces (`TriagingData`, `PlanningData`, etc.)
- Remove the old `StageDefinition` interface from `src/foundation/types.ts`
- Update all imports across the codebase

### 7C. Test Updates

- All existing tests referencing `EPIC_STAGES`, `TASK_STAGES`, or state union types need updating
- New tests:
  - Graph validator: comprehensive test suite with valid/invalid graphs
  - Topology loader: test caching, missing templates, version pinning
  - Engine: test auto-transition depth guard, dynamic stage loading, onTaskCompleted dispatch callback (B4)
  - Template repository: test versioning, concurrent version creation
  - Zod schemas: test validation of valid/invalid payloads
  - Task lifecycle: test createTask with template binding, dependency unblocking, template inheritance from parent epic
  - Prompt composer: test promptOverrides merge priority (stage > template > role)

---

## Migration Strategy

> **Human answer #6**: "We will simply implement the new system. This will not affect the production deployment until a rebuild and restart is done, so that's ok."

This means:
1. **No runtime migration of in-flight tickets** — existing tickets in the old system will break when the new code deploys, but this is acceptable per the human stakeholder.
2. **Database migration is additive** — new tables are added alongside existing ones. The `workflow_tickets` table gets two new nullable columns (`workflow_template_row_id`, `workflow_template_version`).
3. **On first deploy**: existing `workflow_tickets` rows will have NULL template references. The engine will fail to load topology for these tickets. This is expected — they were created under the old system.
4. **Manual cleanup**: after deploy, either cancel old in-flight tickets or manually assign them a template via the UI. The Workflow Assignment Panel allows manually binding a template to an existing ticket.
5. **The old code is deleted, not deprecated** — no compatibility shim.

---

## Observability

Dynamic workflows need better observability than the current `console.warn`:

1. **Structured logging** — all engine operations (transitions, auto-transitions, depth guard hits, dispatch failures) log structured JSON with `ticketId`, `templateRowId`, `fromState`, `toState`, `depth`, `durationMs`
2. **Per-state timing** — the engine records `enteredAt` timestamp in stateData when entering a state, and the transition audit log captures `exitedAt`. The review skill aggregates these.
3. **Health endpoint** — `GET /api/workflow/health` returns: total active tickets, tickets in error states, templates in use, average state dwell time
4. **WebSocket events** — existing `workflow:*` event pattern extended with `workflow:template-created`, `workflow:review-completed`, `workflow:assignment-proposed`

---

## Agent Role Deduplication

When the selection skill proposes a new agent role, before persisting:

1. **Exact name match** — if a role with the same name exists, reuse it
2. **Near-name match** — if a role with a similar name exists (Levenshtein distance < 3), flag it and ask the human to confirm whether to reuse or create new
3. **Deferred semantic dedup** — full semantic similarity (embedding-based) is deferred to a future iteration. For now, name matching + human judgment is sufficient.

---

## Fallback Behavior

If the workflow selection skill fails (timeout, error, LLM refusal):

1. The epic enters a `pending-workflow` state (a new meta-state handled outside the template system)
2. The UI shows: "Workflow design failed — please select a template manually" with the Template Library Browser
3. The human picks a template from the library (or creates one manually)
4. If the library is empty (cold start), the human can describe the workflow they want and re-trigger the selection skill

This avoids the "wrong default template" problem — there IS no default. The human always has the final say.

---

## Rollback for Broken Workflows

If a running epic is pinned to a template version that turns out to be broken:

1. The human can re-bind the epic to a different template version via the Workflow Assignment Panel
2. This requires confirming that the epic's current state exists in the new template
3. If it doesn't, the human can manually transition the epic to a compatible state first
4. All re-bindings are logged in the transition audit trail

---

## Concurrent Modification Handling

Two review skills proposing changes to the same template simultaneously:

1. Each review is stored independently in `workflow_reviews` with its `template_row_id`
2. When applying: check if `template.version` matches the version the review was based on
3. If version has advanced (another change was applied first): warn the human that the template changed since the review was created
4. Human can: re-run the review against the new version, manually merge, or discard

---

## Sub-Epic Breakdown (Recommended Implementation Order)

This is a large scope. Recommended phasing:

### Sub-Epic A: Schema + DB + Engine Core (Phases 1-3)
- Lock JSON schemas
- Create tables and repositories
- Refactor engine to dynamic topology
- Move repository interfaces to application layer
- Delete old state machine files
- **Validation**: `npm run typecheck` passes, existing tests updated, new graph validator tests pass

### Sub-Epic B: Selection Skill + MCP Endpoints (Phase 4)
- Create MCP endpoints for template/role CRUD
- Create the workflow selection skill (creates both epic and task templates)
- Wire up the assignment flow
- **Validation**: Can create an epic and get a workflow proposed via the skill

### Sub-Epic C: UI Surfaces (Phase 6)
- Workflow Assignment Panel
- Template Library Browser
- StateDiagram refactor
- EpicList dynamic filtering
- Review Diff View
- **Validation**: Full visual flow works end-to-end

### Sub-Epic D: Review Skill + Polish (Phase 5 + 7)
- Post-implementation review skill
- Cleanup old code
- Observability improvements
- **Validation**: Review triggers after epic completion, findings stored correctly

---

## Complete File Inventory

### New Files
| File | Purpose |
|------|---------|
| `src/application/workflow/schemas.ts` | Zod schemas for all workflow data structures |
| `src/application/workflow/types.ts` | TypeScript types derived from Zod + runtime helpers |
| `src/application/workflow/graph-validator.ts` | Pure function to validate workflow graph topology |
| `src/application/workflow/topology-loader.ts` | Loads stage definitions from DB for a ticket |
| `src/application/workflow/template-repository.ts` | Repository interface for workflow templates |
| `src/application/workflow/agent-role-repository.ts` | Repository interface for agent roles |
| `src/application/workflow/review-repository.ts` | Repository interface for workflow reviews |
| `src/application/workflow/ticket-repository.ts` | Moved from domain layer — ticket/transition/dependency repos |
| `src/infrastructure/persistence/workflow-template-repository.ts` | SQLite implementation |
| `src/infrastructure/persistence/workflow-agent-role-repository.ts` | SQLite implementation |
| `src/infrastructure/persistence/workflow-review-repository.ts` | SQLite implementation |
| `skills/workflow-select/SKILL.md` | Claude skill for workflow selection/creation |
| `skills/workflow-review/SKILL.md` | Claude skill for post-implementation review |
| `src/ui/workflow/WorkflowAssignmentPanel.tsx` | Workflow proposal approval UI |
| `src/ui/workflow/TemplateLibrary.tsx` | Template browser/manager |
| `src/ui/workflow/ReviewDiffView.tsx` | Review diff display |

### Modified Files
| File | Change |
|------|--------|
| `src/foundation/types.ts` | Remove union types, remove old StageDefinition, add template fields to WorkflowTicket |
| `src/application/workflow/engine.ts` | Dynamic topology loading, runtime depth guard, B4 callback for parent epic dispatch, dynamic task creation |
| `src/application/workflow/prompt-composer.ts` | Data-driven prompt assembly from PromptBlocks + template promptOverrides |
| `src/application/workflow/agent-dispatcher.ts` | Use topology loader + agent role repo + template overrides |
| `src/application/workflow/execution-dispatcher.ts` | Use topology loader, replace hardcoded state strings with trigger-based lookups |
| `src/application/workflow/startup-recovery.ts` | Use topology loader + runtime helpers from types.ts |
| `src/application/workflow/dispatch-coordinator.ts` | Wire B4 callback, replace hardcoded state strings with stage pattern checks |
| `src/application/workflow/dependency-resolver.ts` | Import updates (domain → application) |
| `src/infrastructure/persistence/database.ts` | New tables + migrations |
| `src/infrastructure/persistence/workflow-repository.ts` | Add template fields, update imports |
| `src/server/api.ts` | New endpoints for templates/roles/reviews, add semanticRole to ticket responses |
| `src/mcp/server.ts` | New MCP tools |
| `src/ui/workflow/StateDiagram.tsx` | Accept dynamic stage definitions as props |
| `src/ui/workflow/EpicDetail.tsx` | Dynamic stage rendering |
| `src/ui/workflow/EpicList.tsx` | Replace hardcoded TERMINAL/HUMAN_REVIEW/DONE sets with semanticRole filtering |
| `src/ui/workflow/WorkflowPage.tsx` | Add template library tab |
| `src/ui/workflow/HumanGatePanel.tsx` | API-driven gate detection |
| `src/ui/workflow/WorkflowStateIndicator.tsx` | Data-driven state colors via semanticRole |
| `src/ui/workflow/CreateEpicModal.tsx` | Trigger selection skill on create |

### Deleted Files
| File | Reason |
|------|--------|
| `src/domain/workflow/state-machine.ts` | Replaced by DB-stored templates + topology loader |
| `src/domain/workflow/templates.ts` | Replaced by DB-stored templates (if exists) |
| `src/domain/workflow/repository.ts` | Moved to `src/application/workflow/ticket-repository.ts` |
| `src/domain/workflow/` (directory) | Empty after above moves/deletes |

---

## Blocking Findings Resolution Summary

| # | Finding | Resolution |
|---|---------|------------|
| B1 | Hardcoded state replacement table incomplete — misses ~12 locations across engine.ts, dispatch-coordinator.ts, EpicList.tsx, HumanGatePanel.tsx, execution-dispatcher.ts | Added comprehensive 25-row replacement table in Phase 3G covering every hardcoded state literal across all files. Each entry specifies the dynamic replacement strategy (trigger-based lookup, semanticRole check, or topology loader query). |
| B2 | Task lifecycle completely unspecified — createTask() hardcodes states, no task template selection, splitter unaware of task templates | Added Phase 3H: task template binding via `ticket_type: 'task'` templates, companion task template referenced from epic templates, refactored createTask() with dynamic entry state resolution, splitter agent awareness, review skill covers task metrics. |
| B3 | Domain layer imports from Infrastructure layer — architectural violation | Phase 2B explicitly states all new repos live in application layer. Phase 3D adds new step: move existing `WorkflowTicketRepository`/`WorkflowTransitionRepository`/`TicketDependencyRepository` from `@domain/workflow/repository` to `@application/workflow/ticket-repository.ts`, update all imports, delete domain/workflow/ entirely. |
| B4 | onTaskCompleted() parent-epic dispatch gap — applyTransition bypasses coordinator, no agent dispatch for epic's new state | Phase 3B adds `onEpicAdvanced` callback on WorkflowEngineDeps. onTaskCompleted() calls this after advancing the parent epic. Coordinator wires the callback to `dispatchIfNeeded()` during construction. Full code shown in Phase 3B. |

## Suggestions Resolution Summary

| # | Suggestion | Resolution |
|---|-----------|------------|
| S1 | FALLBACK_TEMPLATE has agentActionable: false everywhere | N/A — no seed templates per human answer #5. Fallback is `pending-workflow` meta-state with manual template selection. |
| S2 | promptOverrides field defined but never wired into composer | Fixed: Phase 3E prompt composer now accepts `templateOverrides?: PromptOverrides` parameter. Priority: stage.promptOverride > template.promptOverrides[agentRoleId] > role preamble. Phase 3F agent dispatcher passes template overrides. |
| S3 | API response needs semanticRole for dynamic filtering | Fixed: Phase 1A adds `SemanticRoleSchema`. Phase 6G defines API response shape change. EpicList.tsx uses `semanticRole` instead of hardcoded state sets. |
| S5 | File change manifest undercounts | Fixed: File inventory now includes EpicList.tsx and HumanGatePanel.tsx in modified files table. Total: 16 new + 19 modified + 4 deleted. |
| S6 | matchCriteria typed as string with no format | Already fixed in Phase 1A with structured `MatchCriteriaSchema` (keywords, complexity, domains, requiresHumanGate). |
| S7 | createTask() needs template binding — larger scope than described | Addressed in B2 fix (Phase 3H). Splitter agent and createTask() both handle task template resolution. |
