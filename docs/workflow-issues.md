# Workflow Issue Lifecycle

A managed issue lifecycle system that takes work items from raw idea through
specification, planning, implementation, review, and merge — with AI agents
handling most stages and human gates at critical decision points.

## Concepts

**Epic** — A top-level work item that traverses the full lifecycle from idea
to merged code. Contains the specification, technical plan, and tracks
all child implementation tasks.

**Task** — An implementation unit (child of an epic) with a simpler lifecycle.
Created by the splitting agent after the technical plan is approved.
Tasks can have dependency relationships determining execution order.

**Human Gate** — A state where progress blocks until a human approves or
rejects. Three gates exist: spec review, plan review, and final review.

**Stage Handler** — Logic that executes when an issue enters a state. For
agent-actionable states, this dispatches AI sessions. For human gates,
this notifies the user and waits.

**Transition** — A recorded state change with the actor (agent, human, or
system), timestamp, and optional comment. Forms an audit trail.

**Dependency** — A "blocked-by" relationship between tasks. A blocked task
cannot start until all its dependencies are resolved (done).

## Epic Lifecycle (15 states, 3 human gates)

```
  idea ──► triaging ◄──► needs-input
               │
               ▼
            specced ──► spec-review [HUMAN GATE]
                            │  │
                  (approve) │  │ (reject → triaging)
                            ▼
                        planning (3 agents, parallel)
                            │
                            ▼
                     plan-critique (2 adversarial agents)
                       │         │
              (issues) │         │ (satisfied)
                       ▼         ▼
                   planning   plan-review [HUMAN GATE]
                                 │  │
                       (approve) │  │ (reject → planning)
                                 ▼
                             splitting (planner agent)
                                 │
                                 ▼
                           in-progress (child tasks execute)
                                 │ (all tasks done)
                                 ▼
                       integration-review (2 agents)
                          │            │
                 (issues) │            │ (satisfied)
                          ▼            ▼
                  integration-fix   final-review [HUMAN GATE]
                                       │  │
                             (approve) │  │ (reject → integration-fix)
                                       ▼
                                   approved ──► merged
```

Any state can transition to `cancelled`.

## Task Lifecycle (6 states, 0 human gates)

```
  blocked ──► ready ──► in-progress ──► code-review
                             ▲              │       │
                             │         (pass)│  (fail)│
                             │              ▼       ▼
                          revision ◄── changes-requested
                                            done
```

Automatic transitions:
- `blocked → ready` when all dependencies reach `done`
- Parent epic `in-progress → integration-review` when all child tasks reach `done`

## Agent Roles

| Role | Stage | Count | Responsibility |
|------|-------|-------|----------------|
| Triage | triaging | 1 | Reviews raw ideas, asks clarifying questions, shapes spec |
| Planner | planning | 3 (parallel) | Creates technical implementation plan |
| Plan Critic | plan-critique | 2 (parallel) | Adversarial review of the plan |
| Splitter | splitting | 1 | Breaks plan into implementation tasks with dependency graph |
| Implementer | task in-progress | 1 per task | Writes code, tests, docs |
| Code Reviewer | task code-review | 1 | Reviews code quality (fkh-review skill) |
| Integration Reviewer | integration-review | 2 (parallel) | Compares deliverables to spec and plan |
| Fixer | integration-fix | 1 | Addresses issues from integration review |

## Human Gates

Three points require explicit human approval:

1. **Spec Review** (`spec-review`) — After triage, the human reviews the
   refined specification. Approve starts technical planning. Reject sends
   back to triage with feedback.

2. **Plan Review** (`plan-review`) — After adversarial agents are satisfied
   with the plan, the human reviews the full technical plan. Approve starts
   implementation. Reject sends back to planning with feedback.

3. **Final Review** (`final-review`) — After integration reviewers confirm
   the implementation matches the spec, the human reviews with links to
   draft PRs. Approve marks ready to merge. Reject sends back for fixes.

## API

### Endpoints

```
GET    /api/workflow/issues              List issues (query: type, state, trackId, parentId)
GET    /api/workflow/issues/:id          Get single issue with children
POST   /api/workflow/issues              Create epic or task
PUT    /api/workflow/issues/:id          Update issue fields
DELETE /api/workflow/issues/:id          Delete issue (cascades children)
POST   /api/workflow/issues/:id/transition   Transition to new state
POST   /api/workflow/issues/:id/approve      Human gate approval
POST   /api/workflow/issues/:id/reject       Human gate rejection
GET    /api/workflow/issues/:id/transitions  Transition audit history
GET    /api/workflow/issues/:id/dependencies Dependency list
POST   /api/workflow/issues/:id/dependencies Add dependency
DELETE /api/workflow/issues/:id/dependencies/:depId  Remove dependency
```

### WebSocket Events

All events broadcast on `ws://host/ws/events`:
- `workflow:created` — New issue created
- `workflow:updated` — Issue fields updated
- `workflow:deleted` — Issue deleted
- `workflow:transitioned` — State changed
- `workflow:approved` — Human approved at gate
- `workflow:rejected` — Human rejected at gate

### MCP Tools

Available to Claude Code sessions via the Workshop MCP server:
- `workshop_list_workflow_issues`
- `workshop_get_workflow_issue`
- `workshop_create_epic`
- `workshop_create_task`
- `workshop_transition_issue`
- `workshop_approve_issue`
- `workshop_reject_issue`
- `workshop_add_dependency`
- `workshop_list_workflow_pending`

## Database Schema

Three new tables:

- `workflow_tickets` — Main entity with type, state, hierarchy, assignments
- `workflow_transitions` — Audit log of every state change
- `ticket_dependencies` — Blocked-by relationships between tasks

Key relationships:
- `parent_id` → `workflow_tickets(id)` ON DELETE CASCADE (epic deletion cascades to tasks)
- `track_id` → `tracks(id)` ON DELETE SET NULL (track deletion preserves issues)
- `depends_on_id` → `workflow_tickets(id)` ON DELETE CASCADE

## Architecture

```
Foundation (types.ts)
    ↓
Domain (state-machine.ts, repository.ts)
    ↓
Infrastructure (database.ts, workflow-repository.ts)
    ↓
Application (engine.ts, prompt-composer.ts, dependency-resolver.ts)
    ↓
Server (workflow-routes.ts, events.ts) + MCP (workflow-tools.ts)
    ↓
UI (WorkflowPage, EpicDetail, StateTimeline, HumanGatePanel)
```

The state machine is data-driven: `EPIC_STAGES` and `TASK_STAGES` arrays define
valid transitions, agent roles, and gate types. The workflow engine reads these
definitions to validate transitions and dispatch agents. Adding a new state is
adding an entry to the array.
