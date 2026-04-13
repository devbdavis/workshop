# Workshop Architecture

This document describes how Workshop is built — layer by layer, subsystem by subsystem. The goal is enough depth that someone could re-implement it or extend it without having to reverse-engineer the codebase.

---

## Layer Overview

Workshop uses a strict layered architecture with forward-only dependencies:

```
┌─────────────────────────────────────────────────────┐
│  UI (React 19 + Vite)                               │
│  Server (Express + WebSocket)    MCP Server         │
├─────────────────────────────────────────────────────┤
│  Application                                        │
│  (use cases, orchestration, engines)                │
├─────────────────────────────────────────────────────┤
│  Domain                                             │
│  (entities, repository interfaces, state machines)  │
├─────────────────────────────────────────────────────┤
│  Foundation                                         │
│  (shared types, branded IDs, config)                │
├─────────────────────────────────────────────────────┤
│  Infrastructure                                     │
│  (SQLite, tmux/node-pty, git, vault, MCP adapters)  │
└─────────────────────────────────────────────────────┘
```

**Rule**: Lower layers never import from higher layers. Infrastructure implements domain interfaces but doesn't depend on application or UI. This boundary is enforced through TypeScript path aliases — each layer lives under a distinct alias (`@foundation/*`, `@domain/*`, etc.).

| Layer | Path | Purpose |
|---|---|---|
| Foundation | `src/foundation/` | Shared types, branded IDs, constants |
| Domain | `src/domain/` | Entity definitions, repository interfaces |
| Infrastructure | `src/infrastructure/` | SQLite, git, tmux, vault, MCP adapters |
| Application | `src/application/` | Use cases, workflow engine, schedulers |
| Server | `src/server/` | Express REST API, WebSocket bridge |
| MCP | `src/mcp/` | Model Context Protocol server |
| UI | `src/ui/` | React frontend |

---

## Core Domain Entities

### Track

The top-level organizing unit. A track is a parallel work stream — a project, feature, or investigation. Tracks are intentionally flexible and don't enforce ticket-level hierarchy.

Key fields:
- `repos[]` — linked git repositories (path + optional remote URL)
- `paths[]` — additional filesystem paths (for non-git contexts)
- `systemPrompt` — injected into every new AI session in this track
- `tickets[]` — many-to-many links to Jira/Linear tickets
- `terminalLayout` — a recursive split tree defining the terminal panel arrangement
- `matrixRoomId` — optional Matrix/Element room binding for async collaboration
- `worktreeMode` — when true, each session gets a dedicated git worktree

### Session

A running (or suspended) terminal instance. Sessions are backed by tmux and survive server restarts.

Key fields:
- `provider` — `claude | codex | gemini | cursor`
- `status` — `starting | active | idle | needs-input | background | suspended | dead`
- `claudeResumeId` — Claude Code session ID used to resume conversations
- `worktreeRoot` — per-session git worktree root (when worktree mode is active)
- `isBackground` — if true, the session runs without a UI terminal; used for dispatched agent work

### WorkflowTicket

A managed work item traversing a lifecycle pipeline defined by a **playbook** (see Workflow Engine below).

Key fields:
- `type` — `epic | task`
- `state` — current lifecycle state (defined by the playbook)
- `parentId` — tasks are children of epics
- `assignedAgent` — which agent role is currently handling this ticket
- `executionData` — JSON blob for agent output: PR URLs, CI links, review results

### Todo

A lightweight Kanban item for work that doesn't need the full workflow pipeline.

States: `backlog → ready → in-progress → review → done`

Key fields:
- `issueKey` — optional Linear/Jira key used to generate branch names
- `pullRequest` — linked PR URL
- `refined` — flag indicating the todo is ready to be dispatched to an agent
- `sessionId` / `agentName` — binding to a running session when dispatched

### ScheduledTask

A cron-based task that dispatches agent work on a schedule.

Key fields:
- `schedule` — `interval | daily | weekly | monthly | cron` with type-specific parameters
- `prompt` — what to send the agent
- `provider` — which AI CLI to use
- `preScript` — shell command whose stdout is prepended to the prompt before dispatch
- `enabled` — on/off toggle
- `lastRunAt` / `nextRunAt` — schedule tracking

### Discussion

A structured multi-agent deliberation. Teams of agents can post proposals, objections, revisions, and votes. Consensus triggers an "act on it" workflow.

Key entities:
- `DiscussionTeam` — a named group of agent participants
- `Discussion` — the main thread (type: `rfc | question | review`)
- `DiscussionMessage` — typed message (`proposal | comment | suggestion | objection | revision | satisfied | unsatisfied`)
- `DiscussionVote` — `satisfied | unsatisfied | abstain`

Consensus rules (per discussion): `unanimous`, `majority` (configurable threshold), or `quorum` (minimum vote count).

### Agent

A reusable AI agent definition. Source can be:
- `global` — discovered from `~/.claude/agents/`
- `project` — checked into the git repo
- `workshop` — bundled templates

Key fields:
- `systemPrompt` — the agent's instructions
- `allowedTools` — tool whitelist
- `maxTurns` — agentic execution limit
- `templateContent` — when synced from a template, the canonical version for drift detection

---

## Infrastructure Subsystems

### Terminal Management

**Files**: `src/infrastructure/terminal/`

Every terminal session is a **tmux session** with a deterministic name derived from the Workshop session ID. The lifecycle:

1. **Create** — `tmux new-session -d -s <name> -x 120 -y 40 -c <cwd>` creates a headless session.
2. **Launch script** — A bash script is written to the session directory (`~/.workshop/sessions/<id>/`). It `cd`s to the project directory and `exec`s the provider CLI with the appropriate flags.
3. **Settings injection** — A `settings.json` is written alongside the launch script. For Claude sessions it contains:
   - `dangerouslySkipPermissions: true` — bypasses workspace trust dialogs
   - `SessionStart` / `SessionEnd` hooks for `--resume` tracking
   - `SubagentStop` hook for workflow execution callbacks
   - `mcpServers` block (when MCP is configured for the track)
4. **WebSocket bridge** — The frontend connects via WebSocket at `/ws/terminal/:sessionId`. The server spawns `node-pty` with `tmux attach-session -t <name>`, giving the browser a live PTY.
5. **Suspension** — On server shutdown, active sessions are marked `suspended`. On restart, `resumeSuspendedSessions()` finds them and marks them active again (the tmux session is still running).
6. **Idle reaping** — Sessions that are idle and in the background are eventually soft-deleted (moved to recycle bin). The tmux process is killed; the database record (including `claudeResumeId`) is preserved for restoration.

**Activity detection** (`pane-detection.ts`): Periodically samples the visible tmux pane content to determine `working | idle | needs-input | logged-out | exited`.

**Environment hygiene**: Workshop strips Nix devshell variables (`NIX_*`, `npm_config_*`) from the tmux environment and propagates only the minimal set needed by the provider CLI. This prevents tooling conflicts when Workshop itself runs inside a Nix shell.

**Worktree mode**: When `worktreeMode` is enabled, each session gets a `git worktree add` at `~/.workshop/sessions/<id>/worktree`. The session CWD is set to that worktree, giving it an isolated checkout.

**Platform differences**: On WSL2, "open in editor" uses `code <path>` and `wt.exe -d <winpath>`. On macOS it uses `cursor` and `open -a iTerm`. Platform is detected at startup by reading `/proc/version`.

### Persistence Layer

**Files**: `src/infrastructure/persistence/`

All state is stored in a single SQLite database (`better-sqlite3`). The schema is created and migrated via `database.ts` — each migration runs in a transaction, and the version is tracked in `PRAGMA user_version`.

Repository implementations follow the domain interfaces exactly. There are no ORMs. Queries are explicit parameterized SQL.

Key tables and their purpose:

| Table | Purpose |
|---|---|
| `tracks` | Project workstreams |
| `track_repos` | Git repos per track (1:N) |
| `track_paths` | Filesystem paths per track (1:N) |
| `sessions` | Terminal instances with full state |
| `tickets` | External Jira/Linear links |
| `summaries` | Versioned AI-generated track summaries |
| `todos` | Kanban items |
| `agents` | Agent definitions |
| `automation_rules` | Event → action rules |
| `automation_runs` | Execution log |
| `prompt_templates` | Reusable prompts |
| `workflow_tickets` | Managed lifecycle tickets (epics + tasks) |
| `workflow_transitions` | Transition audit log |
| `workflow_dependencies` | Task → task blocking relationships |
| `workflow_playbooks` | Playbook definitions (stored JSON) |
| `workflow_agent_roles` | Agent → role mappings per playbook |
| `discussion_teams` / `discussion_members` | Multi-agent teams |
| `discussions` | Discussion threads |
| `discussion_messages` | Thread messages |
| `discussion_votes` | Per-message votes |
| `discussion_sessions` | Discussion→session links |
| `scheduled_tasks` | Cron-based tasks |
| `scheduled_task_runs` | Run history |
| `global_repos` | Registry of tracked repositories |
| `mcp_configs` | Per-track MCP server configurations |

### Git Integration

**Files**: `src/infrastructure/git/`

`git-adapter.ts` runs git commands via `child_process.execSync` and parses porcelain output. It exposes:
- Current branch name
- Last commit hash and message
- Dirty state (modified + untracked file counts)
- Remote URL

`git-watcher.ts` polls repos for branch changes at a configurable interval and fires events that feed the automation engine.

The branch name is also used to construct auto-generated todo names and to infer Linear issue keys from branch prefixes.

### Vault Integration

**Files**: `src/infrastructure/vault/`

The vault is an Obsidian-compatible directory of markdown files at `$WORKSHOP_VAULT_ROOT/Workshop/<track-slug>/`. Workshop treats it as an append-friendly key-value store indexed by filename.

Standard files per track:
- `_overview.md` — auto-generated on track creation
- `decisions.md` — architectural decisions
- `learnings.md` — gotchas, patterns
- `progress.md` — session-by-session progress log

`provisioner.ts` creates the directory and seed files when a track is first accessed. `reader.ts` reads individual files. `writer.ts` appends content with YAML-formatted timestamps.

At session creation time, `compose-vault-context.ts` (application layer) reads all vault files for the track and injects their content into the system prompt, providing agents with long-term memory that persists across sessions.

### MCP Tool Adapters

**Files**: `src/infrastructure/mcp-tools/`

Provider-specific adapters translate Workshop session settings into the config file formats each provider expects:
- `claude-adapter.ts` — Writes `settings.json` for the `--settings` flag
- `codex-adapter.ts` — Writes Codex CLI config
- `gemini-adapter.ts` — Writes Gemini CLI config

### Filesystem Scanners

`agents/filesystem-scanner.ts` — Walks `~/.claude/agents/` looking for `*.md` files and surfaces them as agent definitions. Used to populate the global agent library.

`skills/filesystem-scanner.ts` — Walks `~/.claude/skills/` to discover installed skills.

---

## Application Layer

### Workflow Engine

**Files**: `src/application/workflow/`

The workflow engine is **playbook-driven**: instead of a hardcoded state machine, the valid states, transitions, and agent roles for any epic or task are defined by a playbook — a JSON document validated against a Zod schema at runtime.

A playbook defines:
- `states[]` — each with a semantic role: `entry | processing | human-gate | waiting | terminal | error`
- `transitions[]` — valid `from → to` pairs with optional guard conditions
- `agentRoles[]` — which agent handles each processing state, and how many run in parallel
- `humanGates[]` — states that block until a human explicitly approves or rejects

**Engine responsibilities** (`engine.ts`):
1. Validate transitions against the playbook definition
2. Resolve dependency blocking (a task in `blocked` state can only move to `ready` when all its dependencies are `done`)
3. Dispatch agents for processing states via `execution-dispatcher.ts`
4. Fire `SubagentStop` webhook callbacks when agents complete (allowing the engine to advance state automatically)
5. Detect parent epic transitions (when all child tasks are `done`, advance the epic to the integration phase)

**Prompt composition** (`prompt-composer.ts`):
Builds the execution prompt sent to an agent. Composes from:
- The ticket's title, description, and acceptance criteria
- The playbook's instructions for this state
- The track's context (repos, branches, linked tickets)
- Vault memory for the track
- The assigned agent's system prompt
- Any previous execution data (PR URLs, review results)

**Startup recovery** (`startup-recovery.ts`):
On server start, finds tickets in transient states (`triaging`, `planning`, etc.) and re-dispatches them. Prevents tickets from getting stuck when the server restarts mid-execution.

**Graph validator** (`graph-validator.ts`):
Before saving a new playbook, validates that its state graph is a valid DAG with reachable terminal states and no unreachable nodes.

### Scheduling

**Files**: `src/application/scheduler/`

`task-scheduler.ts` manages a `node-cron` instance per scheduled task. On startup it loads all enabled tasks from the database and registers cron expressions. The scheduler handles:
- Pre-script execution (runs a shell command, captures stdout, prepends to the prompt)
- Agent dispatch (creates a background session, sends the composed prompt)
- Run history recording (start time, end time, status, output)

`schedule-importer.ts` loads bundled schedule templates from `templates/schedules/` and merges them with the database on startup, enabling first-run defaults without manual setup.

### Discussion Service

**Files**: `src/application/discussion/`

`discussion-service.ts` orchestrates the discussion lifecycle:
1. Team creation — assembles agents into a named team with optional role assignments
2. Discussion creation — opens a thread with a type, description, and consensus rule
3. Message posting — agents post typed messages; the service checks if consensus criteria are met after each vote
4. Act-on-consensus — when consensus is reached, generates an implementation prompt and dispatches an agent to carry it out

`discussion-poller.ts` implements long-polling for the UI — clients wait up to 30s for new messages before the server returns an empty response, avoiding WebSocket complexity for discussion threads.

`governance-prompt.ts` builds multi-agent governance prompts for discussion sessions, including the discussion thread history and the consensus rule.

### Automation Engine

**Files**: `src/application/automation-engine/`

The automation engine maps **events** to **actions** via user-defined rules stored in the database.

**Trigger types**:
- `schedule` — cron expression
- `git-change` — branch change detected in a linked repo
- `ticket-status-change` — workflow ticket transitions to a specific state
- `session-end` — a terminal session ends
- `manual` — triggered on-demand via API

**Action types**:
- `regenerate-summary` — invokes the summary generation service for the track
- `run-agent-prompt` — dispatches a background session with a specified prompt
- `sync-tickets` — pulls current status from linked Jira/Linear tickets

The engine records every trigger and outcome in `automation_runs` for debugging.

### Summary Generation

**Files**: `src/application/summary-generation/`

Summaries are generated by invoking `claude --print` (non-interactive Claude CLI) with a composed context prompt. The service:
1. Loads the track's repos (branches, dirty state, last commit)
2. Loads linked external tickets (cached status)
3. Loads the latest vault memory
4. Assembles a prompt requesting a concise status summary
5. Runs `claude --print` with a 30-second timeout
6. Stores the result as a versioned summary record

Summaries are stored with a version counter. The UI can display the latest and allow browsing history.

### Matrix Router

**Files**: `src/application/matrix-router/`

Tracks can be bound to a Matrix/Element room by ID. The router maps incoming Matrix messages to the appropriate track and creates or resumes sessions in the background. Matrix-bound sessions are exempt from idle reaping (they should stay alive indefinitely to handle async messages).

---

## Server Layer

### REST API

**Files**: `src/server/`

An Express server exposing ~60 routes across route modules:

| Module | Prefix | Purpose |
|---|---|---|
| `api.ts` | `/api` | Track CRUD, session lifecycle, summaries |
| `todo-routes.ts` | `/api/todos` | Kanban CRUD, dispatch |
| `workflow-routes.ts` | `/api/workflow` | Ticket lifecycle, transitions, approvals |
| `workflow-playbook-routes.ts` | `/api/workflow/playbooks` | Playbook library |
| `workflow-proposal-routes.ts` | `/api/workflow/proposals` | Playbook proposal approval |
| `scheduled-task-routes.ts` | `/api/scheduled-tasks` | Task CRUD, cron management |
| `discussion-routes.ts` | `/api/discussions` | Discussion lifecycle, voting |
| `agent-routes.ts` | `/api/agents` | Agent library, template sync |
| `skill-routes.ts` | `/api/skills` | Skill discovery |
| `repo-routes.ts` | `/api/repos` | Global repo registry |
| `mcp-config-routes.ts` | `/api/mcp-configs` | MCP server configuration |
| `vault-routes.ts` | `/api/vault` | Vault file operations |
| `execution-hook-routes.ts` | `/api/hooks` | Workflow execution callbacks |
| `auth-routes.ts` | `/api/auth` | Token validation |

### WebSocket

**Files**: `src/server/websocket.ts`

Two WebSocket channels:

**Terminal channel** (`/ws/terminal/:sessionId`): Attaches to the tmux session via `node-pty`. Input from the browser is written to the PTY. Output from the PTY is written to the WebSocket. Resize messages update the PTY dimensions.

**Events channel** (`/ws/events`): Broadcasts real-time events to all connected UI clients:
- `track:updated`, `session:updated`, `session:activity`
- `workflow:transitioned`, `workflow:approved`, `workflow:rejected`
- `todo:updated`, `summary:generated`
- `discussion:message`, `discussion:consensus`
- `notification` — generic notifications

The server pushes events from any application-layer action that changes visible state.

---

## MCP Server

**Files**: `src/mcp/`

A Model Context Protocol server that exposes Workshop's API to Claude Code sessions. It runs as a child process of Claude Code (spawned via the MCP config) and communicates over stdin/stdout using JSON-RPC.

The MCP server starts its own HTTP client pointed at the Workshop REST API. All tools are thin wrappers over API calls — no business logic lives in the MCP server itself.

**Tool categories**:

| Category | Example tools |
|---|---|
| Tracks | `workshop_list_tracks`, `workshop_get_track`, `workshop_create_track`, `workshop_set_context` |
| Sessions | `workshop_list_sessions`, `workshop_create_session` |
| Todos | `workshop_list_todos`, `workshop_create_todo`, `workshop_update_todo`, `workshop_dispatch_todo` |
| Workflow | `workshop_list_workflow_tickets`, `workshop_create_epic`, `workshop_transition_ticket`, `workshop_approve_ticket` |
| Playbooks | `workshop_list_playbooks`, `workshop_propose_playbook`, `workshop_approve_playbook_assignment` |
| Scheduled tasks | `workshop_list_scheduled_tasks`, `workshop_create_scheduled_task`, `workshop_trigger_scheduled_task` |
| Discussions | `workshop_discussion_create`, `workshop_discussion_post`, `workshop_discussion_vote` |
| Vault | `workshop_vault_read`, `workshop_vault_write`, `workshop_vault_append`, `workshop_vault_list` |
| Repos | `workshop_list_repos`, `workshop_add_repo` |
| Summary | `workshop_get_summary`, `workshop_refresh_summary` |

The MCP server is used by Jeeves (the ship AI) and by background agents dispatched for workflow execution, scheduled tasks, and todo dispatch.

---

## UI Layer

**Files**: `src/ui/`

React 19 with Vite, Tailwind CSS v4, and TypeScript strict mode throughout.

### Pages

| Page | Route | Purpose |
|---|---|---|
| Dashboard | `/` | Track grid overview |
| Track View | `/tracks/:id` | Track workspace |
| Kanban | `/kanban` | Global todo board |
| Workflow | `/workflow` | Ticket pipeline |
| Discussions | `/discussions` | Multi-agent deliberation |
| Scheduled Tasks | `/scheduled` | Task scheduler |
| Notifications | `/notifications` | Real-time event log |
| Agents | `/agents` | Agent library |
| Settings | `/settings` | Configuration |

### Terminal Panel

The terminal panel renders an xterm.js terminal connected to the WebSocket terminal channel. Multiple sessions are arranged in a recursive split tree — each node is either a terminal leaf or a horizontal/vertical split with two children. The layout is stored in the database and restored on page load.

The **Office strip** (`TrackOfficeStrip.tsx`) renders a row of character sprites above the terminal panel — one per session. Each sprite animates based on the session's activity state:
- **Working** — upright, active
- **Sleeping** — slumped over desk (idle > 60s)
- **Floor-sleeping** — on the floor (suspended)
- **Dying** — fading out (shutting down)
- **Empty** — desk is vacant

### Real-Time Updates

The UI subscribes to the WebSocket events channel on mount. A custom React hook distributes events to relevant component state. Components that depend on a specific entity type subscribe to the relevant event and refetch from the API when triggered. This avoids complex state synchronization — the API is the source of truth.

---

## Data Flow: Creating and Executing a Workflow Epic

This end-to-end example illustrates how the subsystems interact.

```
User creates epic (UI form)
  → POST /api/workflow/tickets
  → WorkflowRepository inserts record (state: "idea")
  → WorkflowEngine detects entry state
  → ExecutionDispatcher creates background session
  → TerminalManager spawns tmux session
  → Claude session starts with composed prompt
  → Claude completes triage, POSTs to /api/hooks/subagent-stop
  → WorkflowEngine validates transition "idea → specced"
  → DependencyResolver confirms no blocking deps
  → WorkflowRepository records transition
  → WebSocket broadcasts workflow:transitioned
  → UI updates ticket state
  → Ticket enters "spec-review" (human gate)
  → UI renders HumanGatePanel
  → Human clicks Approve
  → POST /api/workflow/tickets/:id/approve
  → WorkflowEngine transitions to "planning"
  → ExecutionDispatcher creates 3 parallel planner sessions
  → ... (continues through lifecycle)
```

---

## Security Model

- The server binds to `127.0.0.1` — never exposed to the network
- An optional auth token can be configured via `WORKSHOP_AUTH_TOKEN`. When set, API requests and WebSocket connections must supply it in the `Authorization` header or the `token` query parameter
- `dangerouslySkipPermissions: true` is set in per-session Claude settings to avoid workspace trust prompts during unattended execution. This is appropriate because Workshop only runs on the local machine under the user's own credentials
- Database files, `.env`, and session directories are gitignored
- WebSocket input is sanitized before use in shell commands

---

## Configuration Reference

Environment variables (all optional — sensible defaults apply):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Backend server port |
| `NODE_ENV` | — | Set to `production` for prod mode |
| `WORKSHOP_DB_PATH` | `./workshop.db` | SQLite database path |
| `WORKSHOP_API_URL` | `http://localhost:3002` | API URL for MCP server and hooks |
| `WORKSHOP_VAULT_ROOT` | `$HOME/projects/WorkflowDocs` | Obsidian vault root |
| `WORKSHOP_PORT` | `3002` | Production server port |
| `WORKSHOP_AUTH_TOKEN` | — | Optional API auth token |
