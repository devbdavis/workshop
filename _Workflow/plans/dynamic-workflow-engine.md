# Dynamic Workflow Orchestration Engine — Implementation Plan

## Overview

Replace the entire hardcoded workflow system (static state machines, static templates, tightly coupled prompt composer) with a dynamic, self-improving workflow orchestration engine. The system selects or creates workflow templates at runtime via Claude skills, stores them in the database, and improves them over time through post-implementation retrospective reviews.

This is a **wholesale replacement** — no backward compatibility with old `EPIC_STAGES`/`TASK_STAGES`. No seed templates. The template library grows organically from actual usage.

---

## Phased Sub-Epics

Given the scope (3 new tables, 2 skills, 4 UI surfaces, engine rewrite), this is split into 4 sequential sub-epics.

### Sub-Epic 1: Schema Contract + Runtime Type System
Lock the JSON schema for workflow templates and agent roles. Replace compile-time union types with runtime-validated generic State objects. Create new DB tables.

### Sub-Epic 2: Dynamic Engine Core
Rewrite `engine.ts`, `state-machine.ts`, `prompt-composer.ts`, `agent-dispatcher.ts`, `dispatch-coordinator.ts` to load topology from DB. Remove all hardcoded state definitions.

### Sub-Epic 3: Workflow Selection + Agent Creation Skills
Build Claude Code skills for template selection/creation and post-implementation review. Wire into epic creation flow.

### Sub-Epic 4: UI Surfaces
Workflow assignment panel, template library browser, dynamic state diagram, review diff view.

---

## Sub-Epic 1: Schema Contract + Runtime Type System

### 1.1 Database Schema

#### `workflow_templates` table

```sql
CREATE TABLE workflow_templates (
  row_id TEXT PRIMARY KEY,                          -- surrogate PK (UUID)
  id TEXT NOT NULL,                                 -- stable template identifier
  version INTEGER NOT NULL DEFAULT 1,               -- monotonically increasing
  name TEXT NOT NULL,
  description TEXT,
  ticket_type TEXT NOT NULL CHECK(ticket_type IN ('epic', 'task')),
  stage_definitions TEXT NOT NULL,                  -- JSON: StageDefinition[]
  prompt_overrides TEXT,                            -- JSON: per-state prompt fragments
  tags TEXT,                                        -- JSON: string[] for matching
  match_criteria TEXT,                              -- JSON: MatchCriteria object (see 1.2)
  usage_count INTEGER DEFAULT 0,
  avg_rating REAL,
  parent_template_id TEXT,                          -- nullable FK for lineage (references row_id)
  created_by TEXT,                                  -- 'system' | 'skill' | 'human'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(id, version)                               -- composite uniqueness constraint
);

CREATE INDEX idx_wf_templates_id ON workflow_templates(id);
CREATE INDEX idx_wf_templates_type ON workflow_templates(ticket_type);
CREATE INDEX idx_wf_templates_tags ON workflow_templates(tags);
```

**Why surrogate PK + UNIQUE(id, version):** This allows multiple rows per template id (one per version). Running epics pin to a specific `row_id`. New versions insert new rows; old rows are never mutated. The `row_id` is what `workflow_tickets.workflow_template_row_id` references.

#### `workflow_agent_roles` table

```sql
CREATE TABLE workflow_agent_roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  prompt_preamble TEXT NOT NULL,                    -- vetted preamble (see 1.3)
  prompt_task_framing TEXT,                         -- task-specific framing template
  prompt_completion_instructions TEXT,              -- how to signal completion
  prompt_constraints TEXT,                          -- guardrails/forbidden actions
  tools_allowed TEXT,                               -- JSON: string[] of MCP tool patterns
  constraints TEXT,                                 -- JSON: operational guardrails
  capability_tier TEXT NOT NULL DEFAULT 'advisory'
    CHECK(capability_tier IN ('advisory', 'code-modification', 'infrastructure-touching')),
  created_by_template_id TEXT,                      -- which template first requested this
  reusable BOOLEAN DEFAULT 1,
  usage_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_wf_agent_roles_tier ON workflow_agent_roles(capability_tier);
CREATE INDEX idx_wf_agent_roles_name ON workflow_agent_roles(name);
```

**Prompt composition from building blocks (Blocking Finding #2 resolution):** Instead of a single freeform `system_prompt` field, agent roles are composed from structured sections:
- `prompt_preamble` — Who you are and your core purpose (from vetted building blocks)
- `prompt_task_framing` — How to interpret the issue/context (template-able with `{{issue.title}}` etc.)
- `prompt_completion_instructions` — What MCP tools to call when done, what states to transition to
- `prompt_constraints` — Forbidden actions, scope limits, required confirmations

The prompt composer concatenates these sections with runtime context (track context, summary, stateData). This prevents freeform prompt injection while allowing per-role customization.

**Vetted preamble library:** A set of approved preambles lives in code (e.g., `PREAMBLE_ANALYST`, `PREAMBLE_IMPLEMENTER`, `PREAMBLE_REVIEWER`). The skill selects from these when creating roles. Novel preambles require human approval.

#### `workflow_reviews` table

```sql
CREATE TABLE workflow_reviews (
  id TEXT PRIMARY KEY,
  template_row_id TEXT NOT NULL REFERENCES workflow_templates(row_id),
  epic_id TEXT NOT NULL REFERENCES workflow_tickets(id),
  structured_findings TEXT,                         -- JSON: ReviewFindings
  suggested_changes TEXT,                           -- JSON: diff against template
  metrics TEXT,                                     -- JSON: per-state timing, retries, etc.
  human_approved BOOLEAN,
  applied_version INTEGER,                          -- version created if approved
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_wf_reviews_template ON workflow_reviews(template_row_id);
```

#### Existing table changes

```sql
ALTER TABLE workflow_tickets ADD COLUMN workflow_template_row_id TEXT;
ALTER TABLE workflow_tickets ADD COLUMN workflow_template_snapshot TEXT;
```

`workflow_template_row_id` binds an issue to its governing template version. `workflow_template_snapshot` stores a full JSON copy of the template at bind time — this is the **rollback escape hatch**. If the referenced template row is somehow broken, the engine can fall back to the snapshot. A human can also manually re-bind an issue to a different template version via the API.

### 1.2 JSON Schema Contracts

#### StageDefinition (in template's `stage_definitions`)

```typescript
interface DynamicStageDefinition {
  /** State name — any string, validated at template save time */
  state: string;
  /** Node type for UI rendering */
  nodeType: 'auto' | 'agent' | 'human-gate' | 'terminal' | 'waiting';
  /** Agent role ID (references workflow_agent_roles.id), or null */
  agentRoleId: string | null;
  /** Number of parallel agent instances to spawn */
  agentCount: number;
  /** Whether agents run in parallel */
  parallel: boolean;
  /** Valid transitions from this state */
  validTransitions: Array<{
    to: string;
    trigger: 'agent-complete' | 'human-approve' | 'human-reject'
      | 'auto' | 'all-deps-resolved' | 'all-tasks-done' | 'manual'
      | 'execution-complete' | 'execution-failed';
    condition?: string;
  }>;
  /** UI metadata */
  phase?: string;
  description?: string;
}
```

#### MatchCriteria (in template's `match_criteria`)

```typescript
interface MatchCriteria {
  /** Keywords that suggest this template is a good fit */
  keywords: string[];
  /** Complexity range: 'trivial' | 'small' | 'medium' | 'large' | 'epic' */
  complexityRange: [string, string];
  /** Required context signals (e.g., "has_infrastructure_changes", "multi_repo") */
  requiredSignals: string[];
  /** Anti-patterns — if present, this template is a poor fit */
  antiSignals: string[];
}
```

#### ReviewFindings (in reviews' `structured_findings`)

```typescript
interface ReviewFindings {
  wallClockPerState: Record<string, number>;  // state -> seconds
  retryLoops: Array<{ states: string[]; count: number }>;
  humanInterventions: number;
  stuckStates: Array<{ state: string; durationSeconds: number }>;
  overallRating: number;  // 1-5
  narrative: string;
}
```

### 1.3 Runtime Type System (Blocking Finding #6 resolution)

**Problem:** `WorkflowState`, `AgentRole`, `HumanGateState` are compile-time union types. Dynamic workflows make all of these `string`. Type guards like `isHumanGate()` are compile-time narrowing that can't work with dynamic strings.

**Solution:** Replace compile-time unions with runtime-validated string types + Zod schemas.

#### New types in `src/foundation/types.ts`

```typescript
// Replace:
//   export type WorkflowState = EpicState | TaskState;
//   export type AgentRole = 'triage' | 'planner' | ...;
//   export type HumanGateState = 'spec-review' | 'plan-review' | 'final-review';
// With:
export type WorkflowState = string & { readonly __brand: 'WorkflowState' };
export type DynamicAgentRoleId = string & { readonly __brand: 'DynamicAgentRoleId' };

// Remove EpicState, TaskState, HumanGateState, AgentRole union types entirely.
// Remove all state-specific data interfaces (TriagingData, PlanningData, etc.)
// — these become generic Record<string, unknown> validated at runtime.
```

#### Zod validation schemas in `src/application/workflow/schema.ts` (NEW FILE)

```typescript
import { z } from 'zod';

export const transitionTriggerSchema = z.enum([
  'agent-complete', 'human-approve', 'human-reject',
  'auto', 'all-deps-resolved', 'all-tasks-done',
  'manual', 'execution-complete', 'execution-failed',
]);

export const transitionSchema = z.object({
  to: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
  trigger: transitionTriggerSchema,
  condition: z.string().optional(),
});

export const stageDefinitionSchema = z.object({
  state: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
  nodeType: z.enum(['auto', 'agent', 'human-gate', 'terminal', 'waiting']),
  agentRoleId: z.string().nullable(),
  agentCount: z.number().int().min(0).max(10).default(1),
  parallel: z.boolean().default(false),
  validTransitions: z.array(transitionSchema),
  phase: z.string().optional(),
  description: z.string().optional(),
});

export const workflowTemplatePayloadSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  issueType: z.enum(['epic', 'task']),
  stageDefinitions: z.array(stageDefinitionSchema).min(1).max(50),
  promptOverrides: z.record(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  matchCriteria: z.object({
    keywords: z.array(z.string()),
    complexityRange: z.tuple([z.string(), z.string()]),
    requiredSignals: z.array(z.string()),
    antiSignals: z.array(z.string()),
  }).optional(),
});

export const matchCriteriaSchema = z.object({
  keywords: z.array(z.string()),
  complexityRange: z.tuple([z.string(), z.string()]),
  requiredSignals: z.array(z.string()),
  antiSignals: z.array(z.string()),
});

export type ValidatedStageDefinition = z.infer<typeof stageDefinitionSchema>;
export type ValidatedTemplatePayload = z.infer<typeof workflowTemplatePayloadSchema>;
```

#### Runtime type guards replace compile-time guards

```typescript
// In src/application/workflow/topology-loader.ts (NEW FILE)
// These replace the functions in src/domain/workflow/state-machine.ts

export function isHumanGate(stages: DynamicStageDefinition[], state: string): boolean {
  const stage = stages.find(s => s.state === state);
  return stage?.nodeType === 'human-gate';
}

export function isTerminal(stages: DynamicStageDefinition[], state: string): boolean {
  const stage = stages.find(s => s.state === state);
  if (!stage) return true;
  return stage.validTransitions.length === 0;
}

export function isAgentActionable(stages: DynamicStageDefinition[], state: string): boolean {
  const stage = stages.find(s => s.state === state);
  return stage?.agentRoleId != null;
}

export function isValidTransition(stages: DynamicStageDefinition[], from: string, to: string): boolean {
  const stage = stages.find(s => s.state === from);
  if (!stage) return false;
  return stage.validTransitions.some(t => t.to === to);
}
```

**Key difference:** Every function now takes `stages: DynamicStageDefinition[]` as a parameter — the topology is always passed in, never assumed from a global constant. Consuming code must load the template's stages before calling these.

### 1.4 Graph Validation (Blocking Finding #3 partial resolution)

Pure domain function in `src/application/workflow/graph-validator.ts` (NEW FILE):

```typescript
export interface GraphValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateWorkflowGraph(
  stages: DynamicStageDefinition[],
  issueType: string,
): GraphValidationResult;
```

**Invariants enforced:**

1. **Reachability:** Every state is reachable from at least one entry state (states with no incoming transitions or only `auto` incoming)
2. **Terminal states:** At least one terminal state exists (no outgoing transitions)
3. **No orphan nodes:** Every non-entry state has at least one incoming transition
4. **No infinite auto-transition loops:** Follow all `auto` trigger chains; detect cycles. Maximum auto-chain depth: 10.
5. **Complexity bounds:** Max 50 states, max 8 transitions per state (fan-out limit)
6. **Human gate invariant (prompt injection defense):** For `issueType === 'epic'`, every workflow with more than 3 states must include at least one `human-gate` nodeType. This prevents an injected prompt from generating workflows that skip all human oversight.
7. **Capability tier gate:** Any state that references an agent role with `capability_tier` above `'advisory'` must have a `human-gate` state reachable within 2 transitions upstream (before the agent can act). This is validated at persist time by querying the agent role's tier.
8. **State name format:** All state names match `^[a-z][a-z0-9-]*$`, max 64 chars

### 1.5 Files Changed (Sub-Epic 1)

| Action | File | Purpose |
|--------|------|---------|
| CREATE | `src/application/workflow/schema.ts` | Zod schemas for all JSON payloads |
| CREATE | `src/application/workflow/graph-validator.ts` | Graph validation pure function |
| CREATE | `src/application/workflow/topology-loader.ts` | Runtime type guards + template loading |
| MODIFY | `src/foundation/types.ts` | Replace union types with branded strings, remove state-specific interfaces |
| MODIFY | `src/infrastructure/persistence/database.ts` | Add new table migrations |
| CREATE | `tests/application/workflow-graph-validator.test.ts` | Graph validation tests |
| CREATE | `tests/application/workflow-schema.test.ts` | Zod schema validation tests |

---

## Sub-Epic 2: Dynamic Engine Core

### 2.1 Topology Loader (`src/application/workflow/topology-loader.ts`)

Extends the file from Sub-Epic 1. Core responsibilities:

1. **Load template for issue:** Given a `WorkflowIssueId`, read `workflow_template_row_id` from the issue, fetch the template row, parse `stage_definitions` JSON, validate with Zod
2. **Load template by ID+version:** Direct lookup for template browsing
3. **Cache:** In-memory LRU cache (keyed by `row_id`) since templates are immutable once written. Invalidate on server restart.
4. **Fallback:** If `workflow_template_row_id` is null (legacy issue or binding failure), try `workflow_template_snapshot`. If both null, throw descriptive error.

```typescript
export interface TopologyLoader {
  /** Load parsed, validated stages for an issue's bound template */
  loadForIssue(issueId: WorkflowIssueId): DynamicStageDefinition[];

  /** Load parsed stages for a specific template row */
  loadByRowId(rowId: string): DynamicStageDefinition[];

  /** Load the full template record */
  loadTemplateByRowId(rowId: string): WorkflowTemplateRecord;

  /** Get the latest version of a template by stable ID */
  loadLatestVersion(templateId: string): WorkflowTemplateRecord | null;
}
```

### 2.2 Engine Refactor (`src/application/workflow/engine.ts`)

**Current:** `isValidTransition(issue.type, issue.state, toState)` — looks up from hardcoded `EPIC_STAGES`/`TASK_STAGES`.

**New:** Every transition validation loads the issue's bound template:

```typescript
function applyTransition(
  issue: WorkflowIssue,
  toState: string,
  actor: TransitionActor,
  comment?: string,
  data?: Record<string, unknown>,
  _depth: number = 0,  // runtime recursion guard
): WorkflowIssue {
  // BLOCKING FINDING #5: Runtime recursion depth guard
  const MAX_AUTO_TRANSITION_DEPTH = 10;
  if (_depth >= MAX_AUTO_TRANSITION_DEPTH) {
    throw new Error(
      `Auto-transition depth limit (${MAX_AUTO_TRANSITION_DEPTH}) exceeded ` +
      `for issue ${issue.id} at state '${issue.state}'. ` +
      `Likely infinite loop in workflow template.`
    );
  }

  const stages = topologyLoader.loadForIssue(issue.id);

  if (!isValidTransition(stages, issue.state, toState)) {
    throw new Error(
      `Invalid transition: cannot go from '${issue.state}' to '${toState}'`
    );
  }

  // ... audit record, state update (same as current) ...

  // Auto-transitions with depth tracking
  const stage = stages.find(s => s.state === toState);
  if (stage) {
    const autoTarget = stage.validTransitions.find(t => t.trigger === 'auto');
    if (autoTarget) {
      return applyTransition(updated, autoTarget.to, autoActor, undefined, undefined, _depth + 1);
    }
  }

  return updated;
}
```

**Circuit breaker update:** The existing plan-critique circuit breaker becomes generic. Instead of checking `issue.state === 'plan-critique' && toState === 'planning'`, count consecutive transitions between the same pair of states from the audit log. If any state-pair loop exceeds N iterations (configurable per-template, default 3), redirect to the nearest upstream human-gate or halt.

**`approve()` / `reject()` refactor:**

```typescript
approve(issueId: WorkflowIssueId, comment?: string): WorkflowIssue {
  const issue = requireIssue(issueId);
  const stages = topologyLoader.loadForIssue(issueId);

  if (!isHumanGate(stages, issue.state)) {
    throw new Error(`Issue '${issue.id}' is not at a human gate (state: ${issue.state})`);
  }

  const stage = stages.find(s => s.state === issue.state);
  const approvalTarget = stage?.validTransitions.find(t => t.trigger === 'human-approve');
  // ... same pattern as current, but using dynamic stages
}
```

### 2.3 Prompt Composer Refactor (`src/application/workflow/prompt-composer.ts`)

**Current:** Giant switch over `AgentRole` union type with hardcoded prompt builders.

**New:** Data-driven from agent role record + template's `prompt_overrides`.

```typescript
export function composeWorkflowPrompt(
  agentRole: AgentRoleRecord,    // loaded from workflow_agent_roles table
  issue: WorkflowIssue,
  context: PromptContext,
  promptOverrides?: Record<string, string>,  // from template's prompt_overrides
): string {
  const parts: string[] = [];

  // 1. Preamble (from building blocks library or role record)
  parts.push(agentRole.promptPreamble);

  // 2. Task framing (interpolated from role record)
  if (agentRole.promptTaskFraming) {
    parts.push(interpolateTemplate(agentRole.promptTaskFraming, { issue, context }));
  }

  // 3. Template-level prompt overrides (per-state customization)
  const stateOverride = promptOverrides?.[issue.state];
  if (stateOverride) {
    parts.push(stateOverride);
  }

  // 4. Completion instructions
  if (agentRole.promptCompletionInstructions) {
    parts.push(interpolateTemplate(agentRole.promptCompletionInstructions, { issue, context }));
  }

  // 5. Constraints
  if (agentRole.promptConstraints) {
    parts.push(agentRole.promptConstraints);
  }

  // 6. Track context + summary (same as current)
  if (context.trackContext) parts.push(`## Track Context\n\n${context.trackContext}`);
  if (context.summary) parts.push(`## Current Status\n\n${context.summary}`);

  return parts.join('\n\n---\n\n');
}
```

The `interpolateTemplate()` function handles `{{issue.title}}`, `{{issue.id}}`, `{{context.planDraft}}` etc. — simple Mustache-style interpolation, no code execution.

### 2.4 Agent Dispatcher Refactor (`src/application/workflow/agent-dispatcher.ts`)

**Current:** `getStageDefinition(issue.type, issue.state)` from hardcoded stages.

**New:** Load stages from topology loader, load agent role from DB:

```typescript
async onTransition(issue: WorkflowIssue): Promise<void> {
  const stages = topologyLoader.loadForIssue(issue.id);
  const stage = stages.find(s => s.state === issue.state);

  if (!stage || !stage.agentRoleId) return;

  // Load the agent role definition from DB
  const agentRole = agentRoleRepo.findById(stage.agentRoleId);
  if (!agentRole) {
    console.warn(`Agent role '${stage.agentRoleId}' not found for state '${issue.state}'`);
    return;
  }

  const count = stage.agentCount || 1;
  const systemPrompt = composeWorkflowPrompt(agentRole, issue, context, template.promptOverrides);
  // ... rest is same dispatch logic
}
```

### 2.5 Startup Recovery Update (`src/application/workflow/startup-recovery.ts`)

Replace `isAgentActionable(t.type, t.state)` and `isTerminal(t.type, t.state)` with dynamic lookups:

```typescript
for (const issue of allIssues) {
  try {
    const stages = topologyLoader.loadForIssue(issue.id);
    if (isTerminal(stages, issue.state)) continue;
    if (!isAgentActionable(stages, issue.state)) continue;
    // ... same recovery logic
  } catch {
    // Template not found — skip this issue, log warning
  }
}
```

### 2.6 HumanGatePending Query Update

The current `findHumanGatePending()` hardcodes `WHERE state IN ('spec-review', 'plan-review', 'final-review')`. This must become dynamic:

**Option chosen:** Query all non-terminal issues, then filter in-memory by loading their template and checking `nodeType === 'human-gate'`. This is acceptable because the issue count is small (Workshop is local-first, not multi-tenant).

Alternatively, add a `is_human_gate BOOLEAN` column to `workflow_tickets` that is set on every state transition by the engine. This avoids the in-memory filter. **Go with this approach** — add the column in the migration.

### 2.7 Delete Old Files

| Action | File |
|--------|------|
| DELETE | `src/domain/workflow/state-machine.ts` |
| DELETE | `src/domain/workflow/templates.ts` |
| DELETE | `tests/domain/workflow-state-machine.test.ts` |

The domain folder cleanup (per Human Answer 1): Move repository interfaces from `src/domain/workflow/repository.ts` to `src/application/workflow/repository.ts`. The `src/domain/workflow/` directory can then be removed entirely.

### 2.8 Files Changed (Sub-Epic 2)

| Action | File | Purpose |
|--------|------|---------|
| MODIFY | `src/application/workflow/engine.ts` | Dynamic topology loading, recursion guard |
| MODIFY | `src/application/workflow/prompt-composer.ts` | Data-driven from agent role records |
| MODIFY | `src/application/workflow/agent-dispatcher.ts` | Dynamic stage/role lookup |
| MODIFY | `src/application/workflow/execution-dispatcher.ts` | Dynamic stage lookup |
| MODIFY | `src/application/workflow/dispatch-coordinator.ts` | Pass through topology context |
| MODIFY | `src/application/workflow/startup-recovery.ts` | Dynamic lookup |
| MODIFY | `src/application/workflow/topology-loader.ts` | Extend with full loading logic |
| MOVE | `src/domain/workflow/repository.ts` → `src/application/workflow/repository.ts` | Domain cleanup |
| DELETE | `src/domain/workflow/state-machine.ts` | Replaced by topology-loader |
| DELETE | `src/domain/workflow/templates.ts` | Replaced by DB templates |
| MODIFY | `src/foundation/types.ts` | Finalize type changes |
| MODIFY | `src/infrastructure/persistence/workflow-repository.ts` | Dynamic human-gate support |
| MODIFY | `src/infrastructure/persistence/database.ts` | Add `is_human_gate` column |
| CREATE | `src/application/workflow/preamble-library.ts` | Vetted prompt preambles |
| CREATE | `src/infrastructure/persistence/workflow-template-repository.ts` | Template CRUD |
| CREATE | `src/infrastructure/persistence/workflow-agent-role-repository.ts` | Agent role CRUD |
| MODIFY | `src/server/workflow-routes.ts` | Update API for dynamic types |
| MODIFY | `src/mcp/workflow-tools.ts` | Update MCP tools for dynamic types |
| MODIFY | `tests/application/workflow-engine.test.ts` | Rewrite for dynamic engine |

---

## Sub-Epic 3: Workflow Selection + Agent Creation Skills

### 3.1 Workflow Selection Skill (`skills/workflow-select/SKILL.md`)

A Claude Code skill that runs when a new epic is created. Per Human Answer 4, this is a Claude skill (not deterministic code).

**Trigger:** Called by the engine/coordinator after `createEpic()`, before any auto-transitions. The epic is created in a `pending-workflow` state (new initial state for all epics).

**Skill behavior:**
1. Receives the epic description, track context, and available template list via MCP tools
2. Queries the template registry: `workshop_list_workflow_templates({ tags, issueType: 'epic' })`
3. Scores templates against the epic description using tag matching + semantic similarity
4. Either selects the best match OR designs a new workflow template
5. If creating new: validates via `workshop_validate_workflow_template({ stageDefinitions })` MCP tool
6. If creating new agent roles: checks for semantic overlap via `workshop_list_agent_roles({ similarTo: "description" })`
7. Presents a unified "Workflow Plan" by transitioning the epic to a `workflow-review` human gate
8. Must complete within a bounded budget (single agent turn); falls back to a minimal pass-through template if skill fails or times out
9. **Lightweight path:** For trivial work, can select/create a single-stage pass-through (e.g., `ready → in-progress → done`)

**New MCP tools (added to `src/mcp/workflow-tools.ts`):**
- `workshop_list_workflow_templates` — query templates by tags, type, usage
- `workshop_create_workflow_template` — validates + persists a new template
- `workshop_validate_workflow_template` — runs graph validation, returns errors/warnings
- `workshop_list_agent_roles` — query existing roles by name, tier, similarity
- `workshop_create_agent_role` — creates a new agent role (human approval required for novel roles)
- `workshop_bind_workflow_template` — binds a template to an epic

**Prompt injection defense (Blocking Finding #3):**
- The graph validator runs on every template before persistence — no exceptions
- The selection skill's system prompt explicitly instructs it to never skip human gates for non-trivial workflows
- The `workshop_create_workflow_template` MCP tool enforces the graph validation invariants server-side regardless of what the skill tries to do
- New agent roles with `capability_tier` above `'advisory'` are created with `pending_approval: true` and cannot be used until a human approves via the UI

**Fallback on skill failure:**
If the selection skill fails, times out, or produces invalid output, the system falls back to a **minimal default template** that is constructed in code (not from DB):
- Epic: `idea → triaging → plan-review (human gate) → executing → done`
- Task: `ready → in-progress → code-review → done`

This fallback is hardcoded as a constant in `topology-loader.ts` and used only when no template can be loaded. It is never persisted to DB.

### 3.2 Agent Role Deduplication

When the skill requests a new agent role, the `workshop_create_agent_role` tool checks:

1. **Exact name match:** If a role with the same name exists and is `reusable`, return the existing role ID
2. **Keyword overlap:** Tokenize the new role's description, compare against existing roles' descriptions. If >70% keyword overlap with any existing role, return that role ID with a note explaining the overlap
3. **No LLM-based semantic dedup** — this is deferred to avoid latency. Keyword overlap is sufficient for v1.

### 3.3 Post-Implementation Review Skill (`skills/workflow-review/SKILL.md`)

Per Human Answer 4, this is also a Claude skill.

**Trigger:** Fired asynchronously when an epic reaches a terminal state (`merged`, `cancelled`, `done`). The dispatch coordinator calls a `scheduleReview(epicId)` function that creates a background session.

**Skill behavior:**
1. Reads the epic's full transition history via `workshop_get_workflow_issue(epicId)` (includes transitions)
2. Computes metrics: wall-clock time per state, retry loops, human interventions, stuck states
3. Compares the executed workflow against the template's expected flow
4. Produces a `workflow_review` record with structured findings and suggested template changes
5. **Never auto-applies changes** — human approves in UI before new template version is minted
6. Identifies merge candidates: templates with >80% structural overlap
7. Flags unused templates (0 usage in last 30 days) for deprecation

**Failure handling:** If the review skill fails, log the error and mark the review as `status: 'failed'`. No retry — reviews are advisory, not critical path.

**Concurrent modification handling:** When creating a new template version from a review, use compare-and-swap: read current max version, attempt INSERT with `version = max + 1`, retry once on UNIQUE constraint violation.

### 3.4 Files Changed (Sub-Epic 3)

| Action | File | Purpose |
|--------|------|---------|
| CREATE | `skills/workflow-select/SKILL.md` | Selection skill definition |
| CREATE | `skills/workflow-review/SKILL.md` | Review skill definition |
| MODIFY | `src/mcp/workflow-tools.ts` | Add template/role management MCP tools |
| MODIFY | `src/application/workflow/dispatch-coordinator.ts` | Wire review trigger |
| CREATE | `src/application/workflow/review-scheduler.ts` | Async review dispatch |

---

## Sub-Epic 4: UI Surfaces

### 4.1 Workflow Assignment Panel

Appears after epic creation when epic is in `workflow-review` state. Shows:
- Selected template name, description, rationale (from skill)
- Agent roster with capability tier badges (advisory=green, code-mod=blue, infra=red)
- New agents flagged with "NEW" badge + pending approval indicator
- Confidence score from the selection skill
- "Approve & Start" button → transitions epic past workflow-review
- "Choose Different Template" → opens template library browser for manual selection
- **Cold-start empty state:** "Designing a custom workflow for this epic..." spinner while skill runs

### 4.2 Template Library Browser

Card-based layout:
- Each card: name, description, usage count, last-used date, avg rating stars
- Click opens detail view with SVG state diagram (generated from `stage_definitions`)
- Filter by tags, search by name/description
- "New Template" button opens template creation form (manual alternative to skill)

### 4.3 Dynamic State Diagram (`src/ui/workflow/StateDiagram.tsx`)

**Current:** Reads from hardcoded `EPIC_DIAGRAM_CONFIG` / `TASK_DIAGRAM_CONFIG`.

**New:** Accepts a `stageDefinitions: DynamicStageDefinition[]` prop and auto-layouts:
- Use a simple layered layout algorithm (Sugiyama-style) to position nodes
- Phase grouping from `stage.phase` field
- Color coding from `stage.nodeType` (same `NODE_STYLES` map)
- Highlight current state for live execution progress
- Mark completed states (from transition history)

The diagram config is now computed from the template data, not hardcoded.

### 4.4 Review Diff View

Shows template before vs. after proposed changes from a review:
- Side-by-side comparison of stage definitions
- Added/removed/modified states highlighted
- Accept/Reject/Modify actions
- On accept: creates new template version, updates the review record

### 4.5 Files Changed (Sub-Epic 4)

| Action | File | Purpose |
|--------|------|---------|
| CREATE | `src/ui/workflow/WorkflowAssignmentPanel.tsx` | Post-creation template review |
| CREATE | `src/ui/workflow/TemplateLibrary.tsx` | Template browsing/management |
| CREATE | `src/ui/workflow/TemplateDetailView.tsx` | Single template detail + diagram |
| CREATE | `src/ui/workflow/ReviewDiffView.tsx` | Before/after template comparison |
| MODIFY | `src/ui/workflow/StateDiagram.tsx` | Accept dynamic stage definitions |
| MODIFY | `src/ui/workflow/workflow-diagram-config.ts` | Auto-layout from stage data |
| MODIFY | `src/ui/workflow/HumanGatePanel.tsx` | Handle dynamic human gates |
| MODIFY | `src/ui/workflow/WorkflowPage.tsx` | Add template library tab |
| MODIFY | `src/ui/workflow/EpicDetail.tsx` | Show bound template info |
| MODIFY | `src/server/workflow-routes.ts` | Template/review API endpoints |

---

## Migration Strategy (Blocking Finding #4 resolution)

Per Human Answer 6: "we will simply implement the new system. this will not affect the production deployment until a rebuild and restart is done."

**Concrete migration steps executed on server startup (in `database.ts`):**

1. **Create new tables:** `workflow_templates`, `workflow_agent_roles`, `workflow_reviews` (idempotent `CREATE TABLE IF NOT EXISTS`)
2. **Add new columns to `workflow_tickets`:** `workflow_template_row_id`, `workflow_template_snapshot`, `is_human_gate` (idempotent `ALTER TABLE ... ADD COLUMN`)
3. **Backfill in-flight issues:** A one-time migration function runs on startup:
   - Query all `workflow_tickets` where `workflow_template_row_id IS NULL`
   - For each, snapshot the current hardcoded stage definitions (the old `EPIC_STAGES`/`TASK_STAGES`) into `workflow_template_snapshot` as JSON
   - Set `is_human_gate` based on current state
   - These issues continue to run using the snapshot fallback path in the topology loader
4. **No template row is created for legacy issues** — they run on snapshot until completion. New epics use the dynamic system.

This migration is safe because:
- New tables are additive (no existing data modified)
- New columns are nullable (no existing rows broken)
- Backfill is a one-time read+write that doesn't change issue state
- The topology loader's fallback path handles `workflow_template_row_id IS NULL`

```typescript
// In database.ts migration section:
function migrateInFlightIssues(db: Database): void {
  const issues = db.prepare(
    "SELECT id, type, state FROM workflow_tickets WHERE workflow_template_row_id IS NULL"
  ).all() as Array<{ id: string; type: string; state: string }>;

  if (issues.length === 0) return;

  // Import the OLD stage definitions one last time for snapshot
  const legacyStages = getLegacyStageDefinitions(); // hardcoded copy preserved for migration

  const updateStmt = db.prepare(
    "UPDATE workflow_tickets SET workflow_template_snapshot = ?, is_human_gate = ? WHERE id = ?"
  );

  for (const issue of issues) {
    const stages = issue.type === 'epic' ? legacyStages.epic : legacyStages.task;
    const isGate = ['spec-review', 'plan-review', 'final-review'].includes(issue.state);
    updateStmt.run(JSON.stringify(stages), isGate ? 1 : 0, issue.id);
  }

  console.log(`[migration] Backfilled ${issues.length} in-flight issues with template snapshots`);
}
```

A frozen copy of `EPIC_STAGES` and `TASK_STAGES` is preserved in `src/application/workflow/legacy-stages.ts` solely for migration backfill. This file is used only by `migrateInFlightIssues()` and can be deleted once all legacy issues have reached terminal states.

---

## Observability

Dynamic workflows need better observability than the current `console.warn`:

1. **Structured logging:** All engine operations (transitions, auto-transitions, circuit breaker activations, dispatch events) log as structured JSON with `issueId`, `templateId`, `fromState`, `toState`, `actor`, `durationMs`
2. **Per-state timing:** Transition records already capture timestamps. The review skill computes wall-clock per state. The UI shows this in the state timeline.
3. **Circuit breaker events:** Logged at `warn` level with full context
4. **Template load failures:** Logged at `error` level; metric counter for monitoring
5. **Skill execution:** Selection and review skill sessions are tracked as regular Workshop sessions with `executionIssueId` linkage

No new external monitoring infrastructure — this uses Workshop's existing logging + the structured data in DB tables. The review skill aggregates metrics post-hoc.

---

## Rollback Mechanism

If an epic is pinned to a broken template version:

1. **Automatic fallback:** The topology loader checks `workflow_template_snapshot` if the template row fails to load or validate
2. **Manual re-binding:** New API endpoint `POST /workflow/issues/:id/rebind-template` accepts a `templateRowId` and rebinds the issue. Only allowed at human-gate states or when the issue is in a non-agent-actionable state (to avoid mid-flight confusion)
3. **Manual state override:** Existing `POST /workflow/issues/:id/transition` with `manual` trigger allows moving to any state defined in the bound template. This is the escape hatch for truly stuck issues.

---

## tools_allowed Validation

The `tools_allowed` field on agent roles references MCP tool names. Validation approach:

- **At creation time:** Log a warning if any tool name doesn't match a known pattern, but allow creation (tools may be added later)
- **At dispatch time:** If a referenced tool doesn't exist in the live MCP registry, log a warning and dispatch without that tool restriction (fail-open, not fail-closed — the agent just gets more tools than intended, which is safer than failing to dispatch)
- **No hard validation against live registry** — MCP tool availability can change between server restarts

---

## Summary of Blocking Finding Resolutions

| # | Finding | Resolution |
|---|---------|------------|
| 1 | Versioning schema broken | Surrogate `row_id` PK + `UNIQUE(id, version)` constraint. See Section 1.1. |
| 2 | system_prompt contradicts building blocks | Replaced with 4 structured fields: `prompt_preamble`, `prompt_task_framing`, `prompt_completion_instructions`, `prompt_constraints`. See Section 1.1 agent roles table. |
| 3 | Prompt injection surface | Graph validator enforces human-gate invariant for non-trivial workflows + capability tier gate. MCP tools enforce server-side. See Section 1.4 + 3.1. |
| 4 | No concrete migration plan | One-time startup migration: snapshot legacy stages into `workflow_template_snapshot`, backfill `is_human_gate`. See Migration Strategy section. |
| 5 | No runtime recursion guard | `_depth` parameter in `applyTransition()`, max 10. See Section 2.2. |
| 6 | Type safety destroyed | Branded string types + Zod runtime validation + topology-aware type guards that take `stages[]` parameter. See Section 1.3. |

---

## File Inventory (All Sub-Epics)

### New Files (14)
- `src/application/workflow/schema.ts`
- `src/application/workflow/graph-validator.ts`
- `src/application/workflow/topology-loader.ts`
- `src/application/workflow/preamble-library.ts`
- `src/application/workflow/review-scheduler.ts`
- `src/application/workflow/legacy-stages.ts` (migration-only, temporary)
- `src/infrastructure/persistence/workflow-template-repository.ts`
- `src/infrastructure/persistence/workflow-agent-role-repository.ts`
- `skills/workflow-select/SKILL.md`
- `skills/workflow-review/SKILL.md`
- `src/ui/workflow/WorkflowAssignmentPanel.tsx`
- `src/ui/workflow/TemplateLibrary.tsx`
- `src/ui/workflow/TemplateDetailView.tsx`
- `src/ui/workflow/ReviewDiffView.tsx`

### Modified Files (17)
- `src/foundation/types.ts`
- `src/infrastructure/persistence/database.ts`
- `src/infrastructure/persistence/workflow-repository.ts`
- `src/application/workflow/engine.ts`
- `src/application/workflow/prompt-composer.ts`
- `src/application/workflow/agent-dispatcher.ts`
- `src/application/workflow/execution-dispatcher.ts`
- `src/application/workflow/dispatch-coordinator.ts`
- `src/application/workflow/startup-recovery.ts`
- `src/application/workflow/dependency-resolver.ts`
- `src/server/workflow-routes.ts`
- `src/mcp/workflow-tools.ts`
- `src/ui/workflow/StateDiagram.tsx`
- `src/ui/workflow/workflow-diagram-config.ts`
- `src/ui/workflow/HumanGatePanel.tsx`
- `src/ui/workflow/WorkflowPage.tsx`
- `src/ui/workflow/EpicDetail.tsx`

### Deleted Files (3)
- `src/domain/workflow/state-machine.ts`
- `src/domain/workflow/templates.ts`
- `tests/domain/workflow-state-machine.test.ts`

### Moved Files (1)
- `src/domain/workflow/repository.ts` → `src/application/workflow/repository.ts`

### New Test Files (2+)
- `tests/application/workflow-graph-validator.test.ts`
- `tests/application/workflow-schema.test.ts`
- `tests/application/workflow-engine.test.ts` (rewrite)

---

## Dependency Additions

- `zod` — runtime schema validation (already commonly used, zero native deps)

No other new dependencies.
