---
name: workflow-select
description: "Select or create a workflow template for a new epic. Tagged: workshop."
user-invocable: true
argument-hint: "<epic-ticket-id>"
---

# Workflow Selection Skill

Select or create a workflow template for a new epic.

## Trigger

When a new epic is created and needs a workflow assigned.

## Behavior

1. Read the epic description and context
2. Query the template registry via `workshop_list_workflow_templates` MCP tool
3. Query the agent role registry via `workshop_list_agent_roles` MCP tool
4. Either select the best match or design a new workflow template
5. If designing a new template, also design a companion task template
6. Validate the workflow graph via `workshop_validate_workflow`
7. Submit for human approval via `workshop_propose_workflow` MCP tool

## Template Design Guidelines

When designing a new workflow template:

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

For trivial work (single-file fix, doc update): create a 2-3 state workflow (ready -> in-progress -> done)

### Companion Task Template

Every epic template with a splitting/execution phase needs a companion task template with ticket_type: 'task'.

**IMPORTANT**: Task templates MUST include a `blocked` state (semanticRole: `waiting`) with an `all-deps-resolved` trigger. The engine creates tasks with dependencies in `blocked` state. Without this state in the template, dependency resolution cannot transition the task and it stays blocked forever.

Required pattern:
```
blocked (waiting) --[all-deps-resolved]--> ready (entry) --[auto]--> implementing (processing)
```

Also include a `cancelled` terminal state reachable from `blocked`, `ready`, and `implementing` via manual trigger.

## Template Structure

### Epic Template Example

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

### Task Template Example

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

### Step 1: Analyze the Epic

Read the epic ticket to understand:
- What type of work is it? (feature, bugfix, refactor, docs, infra)
- What is the complexity? (trivial, simple, moderate, complex)
- Does it require human review gates?
- What agent roles are needed?

### Step 2: Search Existing Templates

```
workshop_list_workflow_templates({ ticketType: "epic" })
```

Look for templates with matching:
- tags
- matchCriteria.keywords
- matchCriteria.complexity

### Step 3: Decide: Select or Create

If a good match exists:
- Use that template
- May need minor customization via promptOverrides

If no match or poor fit:
- Design a new template following the guidelines above
- Also design a companion task template if needed

### Step 4: Validate

```
workshop_validate_workflow({ stageDefinitions: [...] })
```

Fix any validation errors before proposing.

### Step 5: Propose

```
workshop_propose_workflow({
  epicId: "<ticket-id>",
  epicTemplate: { ... },
  taskTemplate: { ... },
  agentRoles: [ ... ],
  rationale: "Selected standard-feature-epic because..."
})
```

The proposal is stored on the ticket for human review. A human must call `workshop_approve_workflow_assignment` to finalize.
