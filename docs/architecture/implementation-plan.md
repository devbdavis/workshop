# Workshop — Implementation Plan

## Tech Stack Decisions

### Backend: Node.js + TypeScript

- Natural fit for real-time WebSocket communication (terminal streaming)
- Claude Code itself is a Node.js tool — aligns integration surface
- Strong typing via TypeScript matches the harness's constraint-enforcement philosophy
- Mature ecosystem for process management and pty handling

### Frontend: React + TypeScript + Vite

- React for component-based UI with xterm.js terminal embedding
- Vite for fast dev server and production builds
- Tailwind CSS for styling — utility-first, no custom CSS bikeshedding
- Monorepo: frontend and backend share TypeScript domain types from `src/foundation/`

### Terminal Management: tmux + node-pty

- **tmux** on the backend manages persistent terminal sessions — survives server restarts, supports reattach
- **node-pty** spawns pseudo-terminals programmatically
- **xterm.js** renders terminals in the browser, connected via WebSocket
- Claude Code sessions are spawned inside tmux panes with `--resume` flags for persistence

### Database: SQLite (via better-sqlite3)

- Local-first, zero-config, single-file database
- Perfect for single-user desktop application
- Stores: tracks, ticket links, summaries, automation rules, session metadata
- File-based backups trivially

### Real-time Communication: WebSocket (ws)

- Terminal I/O streaming (xterm.js ↔ tmux via node-pty)
- Live status updates (git state changes, ticket sync results)
- Session lifecycle events (created, attached, detached, killed)

### Process Management

- Backend runs as a long-lived Node.js server (daemonized or in a terminal)
- tmux server is a peer process — backend communicates via `tmux` CLI commands
- Claude Code instances run inside tmux sessions, each tracked by session ID

---

## Implementation Phases

### Phase 0: Project Bootstrap

Set up the development environment and build pipeline.

**Deliverables:**
- `package.json` with workspace config (monorepo: `server/`, `client/`, `shared/`)
- TypeScript config with strict mode, path aliases matching the layer structure
- ESLint config with custom rules enforcing layer dependencies
- Prettier config
- Vitest for testing
- Basic `scripts/init.sh` that installs deps and verifies tmux is available
- `.gitignore`, `CLAUDE.md`, `AGENTS.md` (initial versions)
- Pre-commit hooks (formatter, linter, structural tests)

**Key constraint:** The build must work from a clean clone with `scripts/init.sh && npm run dev`.

---

### Phase 1: Foundation + Domain Layer

Build the core domain types and persistence layer. No UI yet — validate with tests.

**1a. Foundation types** (`src/foundation/`)
- Track ID, Session ID, Ticket ID — branded string types
- Common result/error types
- Configuration schema (validated with zod)
- Event types (domain events for the automation engine)

**1b. Domain entities** (`src/domain/`)
- `track/` — ProjectTrack entity (name, description, status, repo associations, filesystem paths)
- `session/` — TerminalSession entity (track ID, tmux session name, Claude resume ID, system prompt, state)
- `ticket/` — ExternalTicket entity (source system, external ID, relationship annotation, cached snapshot)
- `summary/` — ProjectSummary entity (track ID, content, version, timestamp)
- `automation/` — AutomationRule entity (track ID, trigger type, action type, config, enabled flag)

**1c. Repository interfaces** (`src/domain/*/repository.ts`)
- Define interfaces for each aggregate's persistence
- No implementations yet — domain layer is pure

**1d. Persistence adapter** (`src/infrastructure/persistence/`)
- SQLite implementation of all repository interfaces
- Migration system for schema changes
- Seed data for development

**Verification:** All domain entity tests pass. Repository contract tests pass against SQLite adapter.

---

### Phase 2: Terminal Session Infrastructure

The hardest and most critical piece — get terminal sessions working end-to-end.

**2a. tmux adapter** (`src/infrastructure/terminal/`)
- Create/destroy tmux sessions programmatically
- Attach/detach to existing sessions
- List running sessions and their state
- Stream I/O from a tmux pane via node-pty

**2b. Claude Code integration**
- Spawn Claude Code inside a tmux session with configurable flags:
  - `--resume` for session persistence
  - `--system-prompt` for track-specific context
  - Working directory set to the track's primary repo
- Detect Claude Code session IDs for resume capability
- Graceful shutdown: send interrupt, wait, then kill

**2c. Session lifecycle service** (`src/application/session-lifecycle/`)
- Create session (create tmux session → spawn Claude Code → record in DB)
- Destroy session (kill process → destroy tmux session → update DB)
- Reattach session (find existing tmux session → reconnect pty)
- List sessions for a track
- Handle orphaned sessions (tmux sessions that exist but aren't in DB)

**2d. WebSocket terminal bridge**
- Server-side: pipe tmux pane I/O to WebSocket
- Client-side: xterm.js connects to WebSocket, renders terminal
- Handle resize events (propagate browser terminal size to tmux pane)
- Handle disconnect/reconnect gracefully

**Verification:** Can create a terminal session from a test script, type into it via WebSocket, see output, close browser, reopen, and reattach to the same session with history preserved.

---

### Phase 3: Minimal Web UI

Get a working UI with dashboard and terminal embedding. Keep it functional, not polished.

**3a. Backend HTTP + WebSocket server**
- Express or Fastify for REST API
- `ws` for WebSocket terminal streaming
- API routes:
  - `GET /api/tracks` — list all tracks
  - `POST /api/tracks` — create track
  - `GET /api/tracks/:id` — get track with sessions, tickets, summary
  - `PUT /api/tracks/:id` — update track
  - `DELETE /api/tracks/:id` — archive track
  - `POST /api/tracks/:id/sessions` — create terminal session
  - `DELETE /api/tracks/:id/sessions/:sid` — destroy session
  - `WS /api/tracks/:id/sessions/:sid/terminal` — terminal I/O stream

**3b. Dashboard view** (`src/ui/dashboard/`)
- Grid of project tracks showing name, status line, active session count
- "New Track" button → creation form
- Click track → navigate to track view

**3c. Track view** (`src/ui/track-view/`)
- Summary panel (read-only display of current summary, last-updated time)
- Context panel (repos with branch/dirty state, linked tickets, filesystem paths)
- Terminal area with resizable panels (xterm.js instances)
- Toolbar: new session, kill session, refresh summary

**3d. Terminal panel** (`src/ui/terminal-panel/`)
- xterm.js component that connects to a session's WebSocket
- Resize handling (drag borders, propagate to backend)
- Visual indicator for session state (active, disconnected, dead)
- Reconnect-on-navigate (don't destroy xterm instance on tab switch)

**Verification:** Can open the browser, create a track, open a Claude Code terminal session, interact with it, navigate away and back, and the session is still there.

---

### Phase 4: Git Integration

**4a. Git adapter** (`src/infrastructure/git/`)
- Given a repo path, read: current branch, last commit (hash + message), dirty state (modified/untracked counts)
- Watch for changes (poll or filesystem watcher) and emit domain events
- Read remote URL for display

**4b. Track-repo association**
- A track can have multiple associated repos
- When creating or editing a track, add repos by filesystem path
- Repos are validated on add (must be a git directory)
- Context panel displays live git state per repo

**Verification:** Associate a repo with a track, see its branch and dirty state update live in the context panel.

---

### Phase 5: External Ticket Integration (Jira/Linear via MCP)

**5a. MCP adapter layer** (`src/infrastructure/mcp/`)
- Registry that maps available MCP servers to their capabilities
- Generic MCP client wrapper that handles connection and error recovery
- Atlassian adapter: search tickets, get ticket details, map to domain types
- Linear adapter: same interface, different source

**5b. Ticket linking** (`src/application/ticket-sync/`)
- Search for tickets from within a track (calls MCP, returns results)
- Link a ticket to a track (creates ExternalTicket record with relationship annotation)
- Unlink a ticket
- Periodic sync: refresh cached ticket status from MCP source

**5c. UI for ticket management**
- Search panel in track view (search box → MCP results → link button)
- Linked tickets displayed in context panel with status badges
- Relationship annotation dropdown (primary, related, blocked-by)

**Verification:** Search for a real Jira ticket from the UI, link it to a track, see its status displayed. Change the ticket status in Jira, trigger sync, see it update.

---

### Phase 6: AI-Maintained Summaries

**6a. Summary generation service** (`src/application/summary-generation/`)
- Given a track, gather context: repo states, linked ticket statuses, recent session activity
- Compose a prompt and send to Claude (via Claude Code headless or API)
- Store the result as a new summary version
- Expose a "regenerate" action

**6b. Summary display**
- Summary panel shows latest version with timestamp
- "Refresh" button triggers regeneration
- Summary history accessible (version list, click to view previous)

**Verification:** Create a track with repos and tickets, trigger summary generation, see a meaningful summary appear in the panel.

---

### Phase 7: Automation Engine

**7a. Automation rule engine** (`src/application/automation-engine/`)
- Rule storage: trigger type + action type + config, stored in DB per track
- Supported triggers: `schedule` (cron), `git-change`, `ticket-status-change`, `session-end`, `manual`
- Supported actions: `regenerate-summary`, `run-agent-prompt`, `sync-tickets`
- Cron scheduler for time-based triggers (node-cron)
- Event listener for domain events (git change detected, session ended, etc.)

**7b. Automation UI**
- Configuration panel in track view
- Create/edit/delete rules
- Test-fire a rule manually
- View recent automation run history (timestamps, results)

**Verification:** Create a rule "regenerate summary when a session ends". End a session. Verify the summary is regenerated automatically.

---

### Phase 8: System Prompt Management

**8a. Prompt template system**
- Track-level default system prompt
- Per-session override capability
- Variable interpolation: `{{track.name}}`, `{{track.repos[0].path}}`, `{{track.tickets}}`, etc.
- Template library stored in DB with names and descriptions

**8b. Prompt UI**
- Editor in track configuration for the default prompt
- Per-session prompt override when creating a new session
- Template library browser: pick a template, customize, save

**Verification:** Set a custom system prompt on a track, create a new session, verify Claude Code receives the system prompt. Override it for a specific session, verify the override takes effect.

---

### Phase 9: Polish and Stretch Goals

**9a. Dashboard improvements**
- Global search across tracks and tickets
- Archive/unarchive tracks
- Keyboard shortcuts for navigation

**9b. Cross-track visualization** (stretch)
- Shared ticket indicators
- Shared repo indicators

**9c. Voice integration** (stretch)
- Spawn Claude Code with `/voice` flag in a dedicated session type
- Audio passthrough via browser microphone API

**9d. Ticket editing via MCP** (stretch)
- Write-back to Jira/Linear (add comments, change status)
- Agent-initiated ticket updates during conversations

---

## Dependency Graph Between Phases

```
Phase 0 (Bootstrap)
  │
  ▼
Phase 1 (Foundation + Domain)
  │
  ├──────────────────┐
  ▼                  ▼
Phase 2 (Terminal)   Phase 4 (Git)
  │                  │
  ▼                  │
Phase 3 (Web UI) ◄───┘
  │
  ├──────────┬──────────┐
  ▼          ▼          ▼
Phase 5    Phase 6    Phase 8
(Tickets)  (Summary)  (Prompts)
  │          │
  └────┬─────┘
       ▼
  Phase 7 (Automation)
       │
       ▼
  Phase 9 (Polish)
```

Phases 2 and 4 can be worked in parallel after Phase 1.
Phases 5, 6, and 8 can be worked in parallel after Phase 3.
Phase 7 depends on 5 and 6 (automation triggers from ticket sync and summary generation).

---

## Risk Areas

**Terminal session persistence** — The tmux + node-pty + xterm.js + WebSocket chain has many failure modes (server restart, browser disconnect, tmux crash, Claude Code process death). This needs the most defensive coding and testing. Build Phase 2 first specifically because it's the hardest.

**MCP reliability** — MCP servers may be unavailable, slow, or return unexpected data. The harness mandates graceful degradation — every MCP call path needs a fallback to cached data or a clear "unavailable" state.

**Claude Code integration** — We're wrapping Claude Code as a subprocess. Its CLI interface, resume behavior, and system prompt handling are our integration surface. Changes to Claude Code could break things. Pin to a known version and document the integration contract.

**xterm.js performance** — Rendering multiple terminal panels simultaneously with high-throughput output (e.g., build logs) can stress the browser. May need output throttling or virtual terminal rendering.

---

*Plan path: `docs/architecture/implementation-plan.md`*
