# Workshop Feature Index

A complete inventory of what Workshop does. Organized by capability area.

---

## Project Tracks

The central organizing unit. A track is a named parallel work stream — a project, feature, or investigation.

- **Dashboard** — Grid view of all active tracks with live status indicators (active sessions, last summary update)
- **Track context** — Each track carries linked git repos, filesystem paths, external tickets, a custom system prompt, and freeform context text
- **Many-to-many ticket links** — A single track can reference multiple Jira/Linear tickets; a ticket can appear across tracks. Relationship annotations supported ("primary", "related", "blocked-by")
- **Versioned summaries** — AI-generated status summaries stored with version history; can be regenerated manually or via automation
- **System prompt templating** — Per-track system prompts support variable interpolation (`{{repo.branch}}`, `{{ticket.status}}`, etc.)
- **Archive** — Tracks can be archived and restored; archived tracks are hidden from the dashboard
- **Terminal layout persistence** — The split-pane arrangement is stored per track and restored on load
- **Matrix room binding** — Tracks can be bound to a Matrix/Element room for async collaboration; Matrix-bound sessions are exempt from idle reaping

---

## Terminal Sessions

Each session is a tmux process managed by the server, with a browser terminal attached via WebSocket.

- **Multi-provider support** — Claude Code, Codex, Gemini, and Cursor CLI are all supported. Provider is selectable per session
- **Session persistence** — Sessions survive page refreshes, browser restarts, and server restarts. tmux keeps the process alive; the server reconnects on startup
- **Claude Code resume** — Claude sessions store a `claudeResumeId` and are started with `--resume` on reconnect, preserving the full conversation history
- **System prompt injection** — On session creation, a composed system prompt is assembled from: track context, vault memory, and the session's assigned agent definition
- **Background sessions** — Sessions can run in the background (no UI terminal), used for dispatched agent work
- **Worktree mode** — When enabled at the track level, each session gets a dedicated `git worktree` checkout, providing branch isolation
- **Activity detection** — The server samples pane content to classify session state: `working | idle | needs-input | logged-out | exited`
- **Idle alerts** — Sessions idle for more than 5 minutes surface a notification
- **Idle reaping** — Background sessions that go idle are soft-deleted to the recycle bin (tmux killed, DB record preserved including `claudeResumeId`); can be restored
- **Recycle bin** — Soft-deleted sessions can be restored to resume the conversation from where it left off
- **Split-pane layout** — Multiple sessions per track rendered as a recursive split tree (horizontal and vertical splits); layout is drag-adjustable and persisted
- **xterm.js frontend** — Full-featured terminal with 256-color, UTF-8, and resize support
- **Environment hygiene** — Nix devshell variables stripped from tmux environment to prevent tooling conflicts
- **MCP per session** — MCP server configurations can be injected into individual Claude sessions

---

## Workflow Ticket Pipeline

A managed lifecycle system for taking work items from raw idea through implementation to merge. Lifecycle behavior is defined by **playbooks** — swappable, runtime-validated state machine definitions.

- **Epics** — Top-level work items traversing the full lifecycle (triage → spec → planning → critique → splitting → implementation → integration review → merge)
- **Tasks** — Implementation units, children of epics, with a simpler lifecycle (blocked → ready → in-progress → code-review → done)
- **Playbooks** — JSON state machine definitions validated at runtime via Zod. States carry semantic roles (`entry | processing | human-gate | waiting | terminal | error`). Adding a new lifecycle variant means writing a new playbook, not changing code
- **Dynamic agent roles** — Each processing state specifies an agent role and a parallelism count. The engine dispatches N background sessions for parallel stages (e.g., 3 planners, 2 adversarial critics)
- **Human review gates** — States with the `human-gate` role block until a human explicitly approves or rejects via the UI. Three default gates: spec review, plan review, final review
- **Dependency tracking** — Tasks can declare `blocked-by` relationships. A blocked task automatically transitions to `ready` when all its dependencies reach `done`
- **Automatic parent advancement** — When all child tasks of an epic complete, the epic advances to the integration review phase automatically
- **Prompt composition** — The engine assembles execution prompts from ticket content, playbook instructions, track context, vault memory, and prior execution data
- **Execution callbacks** — Agents signal completion via a `SubagentStop` webhook. The engine validates the transition and advances state without polling
- **Startup recovery** — Tickets in transient states are re-dispatched on server restart, preventing stuck tickets
- **Audit trail** — Every state transition records actor (human, agent, system), timestamp, and comment
- **Execution data** — Tickets carry a JSON payload for agent output: PR URLs, CI links, review results, diff references
- **Playbook library** — A collection of playbook templates. Users can browse, compare, and select playbooks for new epics
- **Playbook proposal flow** — Agents can propose a playbook for a new epic; the human approves before execution begins
- **State diagram** — The UI renders the playbook DAG as a visual flow graph (`@xyflow/react`)
- **Transition timeline** — Visual history of all state changes with timestamps and actors

---

## Kanban Board (Todos)

A lightweight task board for work that doesn't need the full workflow pipeline.

- **Global board** — All todos across all tracks in a single Kanban view
- **Per-track todos** — Todos can be scoped to a specific track
- **Columns** — `Backlog → Ready → In Progress → Review → Done`
- **Priority levels** — Low, medium, high, with visual indicators
- **Issue key** — Optional Linear/Jira key; used to generate branch names when dispatching
- **PR linking** — Attach a pull request URL to a todo
- **Refinement flag** — Mark todos as "refined" (ready for agent dispatch)
- **Agent dispatch** — Dispatch a refined todo to a background agent. Workshop creates a session, composes a prompt from the todo and track context, and links the session to the todo
- **Drag-and-drop** — Cards are reorderable within columns
- **Detail modal** — Full editor for todo fields, description, notes

---

## Scheduled Tasks

Run agent prompts on a schedule, with optional pre-processing scripts.

- **Schedule types** — `interval` (every N minutes/hours), `daily` (time of day), `weekly` (day + time), `monthly` (date + time), `cron` (arbitrary cron expression)
- **Pre-task scripts** — A shell command runs before dispatch; its stdout is prepended to the prompt. Useful for injecting dynamic context (e.g., current git log, test output)
- **Provider selection** — Each task specifies which AI provider to use
- **System prompt override** — Tasks can use a custom system prompt instead of the track default
- **Enable/disable toggle** — Tasks can be paused without deletion
- **Run history** — Each execution is logged with start time, end time, status, and output
- **Manual trigger** — Tasks can be triggered on-demand via the UI or MCP
- **Template library** — Bundled schedule templates are synced from `templates/schedules/` at startup

---

## Multi-Agent Discussions

A structured deliberation system for decisions that benefit from multiple AI perspectives.

- **Teams** — Named groups of agents. Members can be assigned roles (e.g., "advocate", "critic", "chair")
- **Discussion types** — `RFC` (solicit feedback on a proposal), `question` (answer a question), `review` (review an artifact)
- **Message types** — `proposal | comment | suggestion | objection | revision | satisfied | unsatisfied`
- **Voting** — Agents vote `satisfied | unsatisfied | abstain` on proposals
- **Consensus rules** — Configurable per discussion: `unanimous` (all satisfied), `majority` (threshold %), `quorum` (minimum vote count)
- **Consensus detection** — The service evaluates consensus after each vote; when met, status advances to `consensus`
- **Act on Consensus** — When consensus is reached, the UI offers a one-click "Implement" action. Workshop generates an implementation prompt and dispatches a session to carry it out
- **Long-polling** — The UI polls for new messages; the server holds connections open for up to 30s before returning, keeping the UI responsive without WebSockets
- **Stale detection** — Discussions with no activity for a configurable period are marked `stale`

---

## AI-Generated Summaries

- **Automatic generation** — Summaries are generated by invoking Claude CLI in non-interactive mode (`--print`) with the track's current context
- **Context composition** — Prompt includes: linked repo branches + dirty state + last commit, linked ticket statuses, current vault memory
- **Versioned storage** — Every regeneration creates a new version; previous summaries are browsable
- **Event-driven refresh** — Summaries can regenerate automatically via automation rules (e.g., after a session ends, or on a schedule)
- **Manual trigger** — "Refresh Summary" button available in the track view
- **Timeout handling** — Generation times out at 30 seconds with a graceful error

---

## Vault Memory (Persistent Track Notes)

Long-term, human-readable memory for each track, stored as Obsidian-compatible markdown.

- **Per-track directories** — Each track gets `Workshop/<track-slug>/` in the vault root
- **Standard files** — `_overview.md` (auto-generated), `decisions.md`, `learnings.md`, `progress.md`
- **Custom files** — Additional files can be created via MCP or direct filesystem access
- **Auto-injection** — All vault files for a track are composed into the system prompt when a new AI session starts
- **Append operations** — MCP tools support append-only writes with automatic timestamps; preferred over full rewrites to preserve history
- **WikiLinks** — Standard Obsidian `[[note-name]]` links work for cross-referencing within the vault
- **Human-readable** — Files are plain markdown, readable and editable with any text editor or Obsidian

---

## Automation Rules

Event-driven rules that trigger agent actions.

- **Trigger types** — `schedule` (cron), `git-change` (branch change in linked repo), `ticket-status-change` (workflow state), `session-end`, `manual`
- **Action types** — `regenerate-summary`, `run-agent-prompt` (dispatch a background session), `sync-tickets` (refresh external ticket status)
- **Per-track rules** — Rules are scoped to a specific track
- **Run logging** — Every rule execution is recorded with status and output

---

## MCP Server (Claude Code Integration)

Workshop exposes its full API via MCP, allowing Claude Code sessions to interact with all Workshop subsystems programmatically.

- **90+ tools** — Covers tracks, sessions, todos, workflow tickets, playbooks, scheduled tasks, discussions, vault, repos, summaries, and automation
- **Auth token support** — Optional token-based authentication
- **Runs as child process** — Spawned by Claude Code via MCP config; communicates over stdin/stdout
- **Nix wrapper** — `scripts/mcp-server.sh` resolves the repo root via `BASH_SOURCE`, ensuring correct operation regardless of Claude Code's working directory
- **Background agent support** — Background sessions dispatched by Workshop have Workshop's own MCP config injected, giving them full access to Workshop tools

---

## Agent Library

Reusable agent definitions that can be assigned to workflow roles or sessions.

- **Sources** — `global` (from `~/.claude/agents/`), `project` (committed to git), `workshop` (bundled templates)
- **Fields** — System prompt, allowed tools, max agentic turns, provider
- **Template sync** — Bundled workshop agents can be synced from templates; the UI shows a diff when the local version has drifted from the template
- **Filesystem scanning** — `~/.claude/agents/` is scanned automatically; new files appear without restarting
- **Improvement flow** — "Improve Agent" button invokes the `/improve-agent` skill in a new session, passing the current agent definition for AI-assisted refinement
- **Role assignment** — Agents are assigned to playbook roles per epic

---

## Skills System

Reusable Claude Code skills managed alongside the codebase.

- **Bundled skills** — Workshop ships with 5 skills: `workshop-server`, `workshop-mcp`, `workshop-executor`, `workflow-select`, `workflow-review`
- **Symlink installation** — Skills are symlinked from `skills/` to `~/.claude/skills/`
- **Template sync** — Same drift-detection mechanism as agents: local vs. template diff is visible in the UI
- **Filesystem scanning** — `~/.claude/skills/` is scanned for installed skills
- **Improvement flow** — "Improve Skill" button invokes the `/improve-skill` skill
- **Tracked in git** — All workshop skills are version-controlled under `skills/`

---

## External Issue Tracker Integration

- **Providers** — Linear and Jira
- **Configuration** — API keys and workspace/project configuration stored in Settings
- **Ticket linking** — Many-to-many links between tracks and tickets; relationship annotations
- **Status sync** — Ticket status is cached locally and refreshed on demand or via automation
- **Branch naming** — Todo issue keys are used to construct branch names (e.g., `WRK-123-my-feature`)
- **Linear icon** — Linked Linear tickets show a clickable icon that opens the ticket in Linear

---

## Repository Management

- **Global registry** — A registry of known git repos, independent of tracks
- **Per-track repos** — Repos can be attached to specific tracks
- **Live git state** — Current branch, last commit hash and message, dirty state (modified + untracked counts), remote URL
- **Branch change detection** — Git watcher polls repos for branch changes and triggers automation rules
- **Remote URL linking** — Remote URLs are surfaced as clickable links in the UI

---

## MCP Server Configuration

- **Per-track MCP configs** — Additional MCP servers can be configured per track and are injected into Claude sessions created for that track
- **Global MCP config** — A global default MCP config applies to all sessions
- **Settings UI** — Add, edit, and remove MCP server configurations from the Settings page

---

## Office Visualization

A visual representation of session activity above the terminal panel.

- **Character sprites** — One desk+character SVG per session, auto-generated
- **Activity states** — `working` (upright), `sleeping` (slumped, idle > 60s), `floor-sleeping` (suspended), `dying` (shutting down), `empty` (dead)
- **Provider badges** — Claude, Codex, Gemini, Cursor logos displayed per session
- **Idle duration** — Time since last activity shown on sleeping characters
- **Session name** — Displayed below the character

---

## Notifications

- **Real-time event log** — All server-side events (session state changes, summary regenerations, workflow transitions, discussion messages) are surfaced in a notification feed
- **WebSocket delivery** — Events arrive via the `/ws/events` channel without polling
- **Persistent log** — Recent events are stored and browsable even after page navigation

---

## Settings

- **Prompt template library** — Create, edit, and reuse prompt templates across tracks and sessions
- **Default AI CLI** — Configure which provider is used by default for new sessions
- **Theme** — Dark / light mode toggle
- **Auth token** — Configure the server auth token
- **Issue tracker** — Linear/Jira API credentials and workspace configuration
- **Soul editor** — Edit the Jeeves agent personality (`soul.md`) that governs how the ship AI behaves

---

## Developer Experience

- **Nix devshell** — `flake.nix` provides Node.js 24 and tmux; `direnv allow` activates automatically
- **Dev + prod simultaneously** — Dev server (`:3001`/`:5173`) and prod server (`:3002`) can run at the same time against separate databases
- **Hot module replacement** — Vite HMR for fast UI iteration
- **TypeScript strict mode** — Throughout; ESM imports; no `any` drift
- **Vitest** — Test suite for application and domain logic
- **Prettier** — Consistent formatting via `npm run format`
- **Max 300 lines per file** — Enforced by convention; keeps modules navigable
- **No barrel files** — Explicit imports only; no re-export chains
- **Branded IDs** — `TrackId`, `SessionId`, etc. prevent ID type confusion at compile time
