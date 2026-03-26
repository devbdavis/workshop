---
name: workflow-select
description: "Select or design a workflow playbook for a new epic. Tagged: workshop."
user-invocable: true
argument-hint: "<epic-ticket-id>"
---

# Playbook Selection Skill

Select or design a workflow playbook for a new epic.

## Trigger

When a new epic is created and needs a playbook assigned.

## Behavior

1. Read the epic description and context
2. **Read design heuristics** from `Workshop/General/playbook-patterns.md` via `workshop_vault_read`
3. **Read past learnings** from `Workshop/General/playbook-learnings.md` via `workshop_vault_read` (skip if not found — it's populated by post-execution reviews)
4. Query the playbook registry via `workshop_list_playbooks` MCP tool
5. Query the agent role registry via `workshop_list_agent_roles` MCP tool
6. Either select the best match or design a new playbook
7. If designing a new playbook, also design a companion task playbook
8. Validate the workflow graph via `workshop_validate_workflow`
9. Submit for human approval via `workshop_propose_playbook` MCP tool
10. **Cite specific patterns** from playbook-patterns.md and learnings in your rationale

## Design Knowledge

Before designing or selecting a playbook, consult the patterns file for heuristics on:
- When to include independent evaluator stages (generator-evaluator separation)
- When to require testable acceptance criteria before execution
- Whether to use single-agent or multi-agent orchestration (context management)
- Where to place human gates (high-stakes decisions only, not mechanical checkpoints)
- Whether a lightweight path is more appropriate (trivial work doesn't need full pipelines)

If past learnings exist, check for:
- Patterns that worked well for similar task types
- Stages that were flagged as non-load-bearing overhead
- Agent role definitions that were flagged as poorly fitting
- Recurring issues that suggest structural changes

## Playbook Design Guidelines

When designing a new workflow playbook:

### Stage Definitions

- Each stage needs: state (kebab-case), semanticRole, agentActionable, humanGate, validTransitions
- First stage should have semanticRole: 'entry'
- Must have at least one humanGate stage for non-trivial workflows
- Terminal stages have empty validTransitions arrays and semanticRole: 'terminal'
- Agent-actionable stages need agentRoleId

### Trigger Types

Available triggers:
- `agent-complete` - Agent finished its work at this stage
- `human-approve` - Human approved at a gate
- `human-reject` - Human rejected at a gate
- `auto` - Automatic transition (no wait)
- `all-deps-resolved` - All dependencies are resolved
- `all-tasks-done` - All child tasks completed
- `manual` - Manual transition by user
- `execution-complete` - Execution phase completed successfully
- `execution-failed` - Execution phase failed

### Semantic Roles

Available roles:
- `entry` - Workflow start state
- `processing` - Agent or system working
- `human-gate` - Requires human decision
- `terminal` - End state (done, merged, cancelled)
- `error` - Failure/stuck state
- `waiting` - Blocked on external dependency

### Capability Tiers

- `advisory` - Read-only, no code changes
- `code-modification` - Can edit files, run builds
- `infrastructure` - Can touch infra, deploy

### Lightweight Path

For trivial work (single-file fix, doc update): create a 2-3 state workflow (ready -> in-progress -> done). Don't over-engineer the playbook for simple tasks.

### Companion Task Playbook

Every epic playbook with a splitting/execution phase needs a companion task playbook with ticket_type: 'task'.

**IMPORTANT**: Task playbooks MUST include a `blocked` state (semanticRole: `waiting`) with an `all-deps-resolved` trigger. The engine creates tasks with dependencies in `blocked` state. Without this state in the playbook, dependency resolution cannot transition the task and it stays blocked forever.

Required pattern:
```
blocked (waiting) --[all-deps-resolved]--> ready (entry) --[auto]--> implementing (processing)
```

Also include a `cancelled` terminal state reachable from `blocked`, `ready`, and `implementing` via manual trigger.

## Playbook Structure

### Epic Playbook Example

```json
{
  "id": "feature-epic-v1",
  "name": "Standard Feature Epic",
  "description": "Multi-stage feature workflow with planning and review gates",
  "ticketType": "epic",
  "stageDefinitions": [
    {
      "state": "triaging",
      "semanticRole": "entry",
      "agentActionable": true,
      "humanGate": false,
      "agentRoleId": "triage-agent",
      "validTransitions": [
        { "to": "spec-review", "trigger": "agent-complete" },
        { "to": "needs-input", "trigger": "agent-complete" }
      ]
    },
    {
      "state": "spec-review",
      "semanticRole": "human-gate",
      "agentActionable": false,
      "humanGate": true,
      "validTransitions": [
        { "to": "planning", "trigger": "human-approve" },
        { "to": "triaging", "trigger": "human-reject" }
      ]
    },
    {
      "state": "planning",
      "semanticRole": "processing",
      "agentActionable": true,
      "humanGate": false,
      "agentRoleId": "planner-agent",
      "validTransitions": [
        { "to": "plan-review", "trigger": "agent-complete" }
      ]
    },
    {
      "state": "plan-review",
      "semanticRole": "human-gate",
      "agentActionable": false,
      "humanGate": true,
      "validTransitions": [
        { "to": "executing", "trigger": "human-approve" },
        { "to": "planning", "trigger": "human-reject" }
      ]
    },
    {
      "state": "executing",
      "semanticRole": "processing",
      "agentActionable": true,
      "humanGate": false,
      "agentRoleId": "executor-agent",
      "validTransitions": [
        { "to": "final-review", "trigger": "execution-complete" },
        { "to": "execution-failed", "trigger": "execution-failed" }
      ]
    },
    {
      "state": "final-review",
      "semanticRole": "human-gate",
      "agentActionable": false,
      "humanGate": true,
      "validTransitions": [
        { "to": "done", "trigger": "human-approve" },
        { "to": "executing", "trigger": "human-reject" }
      ]
    },
    {
      "state": "done",
      "semanticRole": "terminal",
      "agentActionable": false,
      "humanGate": false,
      "validTransitions": []
    },
    {
      "state": "execution-failed",
      "semanticRole": "error",
      "agentActionable": false,
      "humanGate": false,
      "validTransitions": [
        { "to": "planning", "trigger": "manual" }
      ]
    }
  ],
  "tags": ["feature", "standard"],
  "matchCriteria": {
    "keywords": ["feature", "implementation", "new functionality"],
    "complexity": "moderate"
  }
}
```

### Task Playbook Example

```json
{
  "id": "feature-task-v1",
  "name": "Standard Feature Task",
  "description": "Task workflow for feature implementation",
  "ticketType": "task",
  "stageDefinitions": [
    {
      "state": "blocked",
      "semanticRole": "waiting",
      "agentActionable": false,
      "humanGate": false,
      "validTransitions": [
        { "to": "ready", "trigger": "all-deps-resolved" },
        { "to": "cancelled", "trigger": "manual" }
      ]
    },
    {
      "state": "ready",
      "semanticRole": "entry",
      "agentActionable": false,
      "humanGate": false,
      "validTransitions": [
        { "to": "implementing", "trigger": "auto" },
        { "to": "cancelled", "trigger": "manual" }
      ]
    },
    {
      "state": "implementing",
      "semanticRole": "processing",
      "agentActionable": true,
      "humanGate": false,
      "agentRoleId": "coder-agent",
      "validTransitions": [
        { "to": "code-review", "trigger": "agent-complete" },
        { "to": "cancelled", "trigger": "manual" }
      ]
    },
    {
      "state": "code-review",
      "semanticRole": "human-gate",
      "agentActionable": false,
      "humanGate": true,
      "validTransitions": [
        { "to": "done", "trigger": "human-approve" },
        { "to": "implementing", "trigger": "human-reject" }
      ]
    },
    {
      "state": "done",
      "semanticRole": "terminal",
      "agentActionable": false,
      "humanGate": false,
      "validTransitions": []
    },
    {
      "state": "cancelled",
      "semanticRole": "terminal",
      "agentActionable": false,
      "humanGate": false,
      "validTransitions": []
    }
  ],
  "tags": ["feature", "task"]
}
```

## Agent Role Example

```json
{
  "id": "triage-agent",
  "name": "Triage Agent",
  "description": "Analyzes incoming epics to clarify scope and identify blockers",
  "promptBlock": {
    "preamble": "You are a triage agent. Analyze the epic description...",
    "toolAccessTier": "advisory",
    "constraints": [
      "Do not modify any files",
      "Ask clarifying questions if scope is unclear"
    ],
    "completionInstructions": "Transition to spec-review when analysis is complete"
  },
  "toolsAllowed": ["Read", "Grep", "Glob"],
  "capabilityTier": "advisory",
  "reusable": true
}
```

## Fallback

If you cannot decide, propose a minimal workflow:

```
entry -> human-gate -> execute -> review -> done
```

With stages:
- `idea` (entry) -> `spec-review` (human-gate) via auto
- `spec-review` -> `executing` via human-approve
- `executing` -> `final-review` via execution-complete
- `final-review` -> `done` via human-approve

## Workflow

### Step 1: Read Design Knowledge

```
workshop_vault_read({ path: "General/playbook-patterns.md" })
workshop_vault_read({ path: "General/playbook-learnings.md" })
```

Use these heuristics and past findings to inform your design decisions.

### Step 2: Analyze the Epic

Read the epic ticket to understand:
- What type of work is it? (feature, bugfix, refactor, docs, infra)
- What is the complexity? (trivial, simple, moderate, complex)
- Does it require human review gates?
- What agent roles are needed?
- Does it need an independent evaluator? (see pattern #1)
- Should acceptance criteria be explicit? (see pattern #2)

### Step 3: Search Existing Playbooks

```
workshop_list_playbooks({ ticketType: "epic" })
```

Look for playbooks with matching:
- tags
- matchCriteria.keywords
- matchCriteria.complexity

### Step 4: Decide: Select or Create

If a good match exists:
- Use that playbook
- May need minor customization via promptOverrides

If no match or poor fit:
- Design a new playbook following the guidelines above
- Also design a companion task playbook if needed
- Apply relevant patterns from the design knowledge base

### Step 5: Validate

```
workshop_validate_workflow({ stageDefinitions: [...] })
```

Fix any validation errors before proposing.

### Step 6: Propose

```
workshop_propose_playbook({
  epicId: "<ticket-id>",
  epicPlaybook: { ... },
  taskPlaybook: { ... },
  agentRoles: [ ... ],
  rationale: "Selected standard-feature-epic because... Applied patterns: generator-evaluator separation (pattern #1) because task involves subjective UI quality."
})
```

The proposal is stored on the ticket for human review. A human must call `workshop_approve_playbook_assignment` to finalize.
