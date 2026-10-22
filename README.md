# Workshop

> *This is my Workshop. There are many like it, but this one is mine.*
> *My Workshop is my best friend. It is my life. I must master it as I must master my life.*
> *Without me, my Workshop is useless. Without my Workshop, I am useless.*
>
> — Fab's Work Orchestration Creed

### Why build your own?

Building a personal workshop is the "hello world" of AI-assisted development in 2026. Everyone's workflow is different, and the best orchestration layer is the one shaped around how *you* think and work.

There's a common baseline worth having — scheduling tasks, human review checkpoints, context composition for agent sessions. Company-level guidelines around tech stack choices, test-driven development, and quality standards are in the works and will layer on top. Beyond that foundation, go wild. Make it weird. Make it yours.

This repo is here as inspiration and a starting point. Read the code, steal the ideas, disagree with half of it, and build something better. Or just clone it and start hacking — it's a solid foundation either way.

New here? The [Setup Guide](docs/setup-guide.md) gets all the external pieces wired up, and [Creating Tracks](docs/creating-tracks.md) walks through actual usage. For a complete picture of what's built: [Feature Index](docs/features.md) and [Architecture Guide](docs/architecture.md). To run Workshop in a container (incl. unraid): [Docker Guide](docs/docker.md). Want to build your own from scratch? [Build Your Own Workshop](docs/build-your-own-workshop.md) is a full design doc plus a ready-to-paste prompt for an AI agent.

---

A local-first project command center for managing parallel work tracks with AI-assisted terminal sessions.

Workshop lets you organize development work into **tracks** — each with linked repos, terminal sessions, AI-generated summaries, and a workflow issue pipeline. It provides a web UI for managing everything from a single dashboard, and an MCP server so Claude Code can interact with your tracks programmatically.

## Prerequisites

- **Nix + direnv** (recommended) — provides Node.js 24 and tmux automatically; see [Setup Guide](docs/setup-guide.md)
- **Node.js >= 24** — required if not using Nix
- **tmux** — required for terminal session management
- **Claude Code CLI** (`claude`) — for AI-assisted terminal sessions
- **macOS or Linux** — node-pty requires a Unix environment

### Claude Code: allow-edits mode

Workshop dispatches background agents that need to read and write files without prompting. Set `defaultMode` to `acceptEdits` in `~/.claude/settings.json` so Claude never pauses to ask permission mid-task:

```json
{
  "permissions": {
    "defaultMode": "acceptEdits"
  }
}
```

If `~/.claude/settings.json` doesn't exist yet, create it with just that content. Existing entries are merged — adding `defaultMode` won't affect your `allow`/`deny` lists or hooks.

### Quick environment setup (Nix)

```bash
cd workshop
direnv allow   # activates the Nix dev shell automatically on entry
```

For full setup instructions including Nix installation, see the [Setup Guide](docs/setup-guide.md).

### Recommended: trust `~/.workshop` in direnv

Workshop clones repos under `~/.workshop/`. If you use direnv within those repos, you'd normally need to run `direnv allow` for each one. You can skip that by whitelisting the prefix in `~/.config/direnv/direnv.toml`:

```toml
[whitelist]
prefix = ["~/.workshop"]
```

`~` is expanded by direnv, so this works regardless of your home directory. Add it alongside any existing `prefix` entries.

For Claude Code CLI installation, see [claude.ai/download](https://claude.ai/download).

## Quick Start

```bash
# Clone and install
git clone <repo-url> && cd workshop
./scripts/init.sh          # Checks prerequisites and runs npm install

# Start development server
npm run dev                # Backend on :3001, Vite on :5173
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Environment Variables

All configuration is optional — sensible defaults are provided. See `.env.example` for the full list.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Backend server port |
| `NODE_ENV` | — | Set to `production` for prod mode |
| `WORKSHOP_DB_PATH` | `./workshop.db` | SQLite database file path |
| `WORKSHOP_API_URL` | `http://localhost:3002` | API URL for MCP server and permission hooks |
| `WORKSHOP_VAULT_ROOT` | `$HOME/projects/WorkflowDocs` | Obsidian vault root for persistent track memory |
| `WORKSHOP_PORT` | `3002` | Production server port (used by `scripts/workshop.sh`) |

## Scripts

```bash
npm run dev          # Start dev server (backend + Vite HMR)
npm run dev:server   # Backend only (tsx watch)
npm run dev:client   # Frontend only (Vite)
npm run build        # Production build (Vite + tsc)
npm test             # Run all tests (Vitest)
npm run typecheck    # TypeScript type checking
npm run format       # Format code with Prettier
```

## Production Server

The production server is managed separately and can run alongside the dev server:

```bash
scripts/workshop.sh start    # Start prod (port 3002, DB ~/.workshop/workshop.db)
scripts/workshop.sh stop     # Stop the server
scripts/workshop.sh restart  # Restart after code changes
scripts/workshop.sh status   # Check if running
scripts/workshop.sh logs     # Tail the log file
```

After frontend changes, rebuild before restarting:

```bash
npm run build && scripts/workshop.sh restart
```

## Architecture

Layered architecture with strict forward-only dependencies:

```
UI (React 19) --> Application --> Domain --> Foundation
                      |
                Infrastructure (SQLite, Git, Terminal, MCP)
```

| Layer | Path | Purpose |
|---|---|---|
| Foundation | `src/foundation/` | Shared types, branded IDs, config |
| Domain | `src/domain/` | Business entities and repository interfaces |
| Infrastructure | `src/infrastructure/` | Adapters: SQLite persistence, git, tmux terminals, MCP |
| Application | `src/application/` | Use cases, orchestration, workflow engine |
| Server | `src/server/` | Express HTTP + WebSocket server |
| UI | `src/ui/` | React frontend with Vite |

**Dependency rule**: No lower layer may import from a higher layer.

## Tech Stack

- **Backend**: Node.js, Express, WebSocket (ws), SQLite (better-sqlite3), node-pty, tmux
- **Frontend**: React 19, Vite, Tailwind CSS v4, xterm.js
- **Language**: TypeScript (strict mode, ESM throughout)
- **Testing**: Vitest
- **AI Integration**: Claude Code CLI, MCP (Model Context Protocol)

## MCP Server

Workshop exposes its API as an MCP server, allowing Claude Code to interact with tracks, sessions, todos, and the workflow system programmatically.

### Setup

1. Start the Workshop server (dev or production)

2. Add the MCP server to your Claude Code config (`~/.claude.json`):

**If using Nix** (recommended — ensures Node 24 without a system-level install):

```json
{
  "mcpServers": {
    "workshop": {
      "command": "/path/to/workshop/scripts/mcp-server.sh",
      "env": {
        "WORKSHOP_API_URL": "http://localhost:3002"
      }
    }
  }
}
```

The wrapper script resolves the repo path via `BASH_SOURCE`, so no `cwd` is needed and it works correctly regardless of where Claude Code is running.

**If using system Node 24+**:

```json
{
  "mcpServers": {
    "workshop": {
      "command": "npx",
      "args": ["tsx", "/path/to/workshop/src/mcp/server.ts"],
      "env": {
        "WORKSHOP_API_URL": "http://localhost:3002"
      }
    }
  }
}
```

3. Restart Claude Code. You should see `workshop_*` tools available.

### Available MCP Tools

| Tool | Purpose |
|---|---|
| `workshop_list_tracks` | List all active tracks |
| `workshop_get_track` | Get track details |
| `workshop_create_track` | Create a new track |
| `workshop_set_context` | Set freeform context for a track |
| `workshop_get_context` | Get track context + latest summary |
| `workshop_create_session` | Create a new AI terminal session |
| `workshop_list_todos` | List todos (filterable) |
| `workshop_create_todo` | Create a todo |
| `workshop_dispatch_todo` | Dispatch a todo to a background agent |

See `src/mcp/server.ts` for the complete list.

## Claude Code Skills

Workshop includes [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) for server management, MCP interaction, and workflow execution. Symlink the whole set:

```bash
ln -s "$(pwd)/skills/workshop-server"   ~/.claude/skills/workshop-server
ln -s "$(pwd)/skills/workshop-mcp"      ~/.claude/skills/workshop-mcp
ln -s "$(pwd)/skills/workshop-executor" ~/.claude/skills/workshop-executor
ln -s "$(pwd)/skills/workflow-select"   ~/.claude/skills/workflow-select
ln -s "$(pwd)/skills/workflow-review"   ~/.claude/skills/workflow-review
```

| Skill | Purpose |
|---|---|
| `workshop-server` | Start, stop, restart, and check the Workshop production server |
| `workshop-mcp` | Interact with Workshop MCP tools (tracks, todos, sessions) from Claude Code |
| `workshop-executor` | Execute an approved implementation plan — delegates to team agents and reports back |
| `workflow-select` | Select or design a playbook for a new workflow epic |
| `workflow-review` | Post-implementation review: evaluates outcome and feeds learnings back into the playbook |

After symlinking, Claude Code will automatically discover and use these skills when relevant.

## Key Concepts

### Tracks
A track represents a parallel work stream — a project, feature, or investigation. Each track has linked repos, terminal sessions, context, summaries, and workflow issues.

### Sessions
Terminal sessions are tmux-backed, with optional Claude Code or Codex CLI integration. Sessions survive server restarts. The system auto-composes a context-rich system prompt for each new AI session from the track's context, vault memory, and latest summary.

### Workflow Issues
A full lifecycle pipeline for work items: idea -> triage -> spec review -> planning -> critique -> plan review -> task splitting -> parallel implementation -> code review -> integration review -> final review -> merge. Includes human review gates and inter-task dependency tracking.

### Vault Memory
Each track can have persistent Obsidian-compatible markdown notes (decisions, learnings, progress) stored at `$WORKSHOP_VAULT_ROOT/Workshop/{track-slug}/`. These are automatically injected into session system prompts.

## Conventions

- ESM imports throughout (`import`, not `require`)
- Branded string types for IDs (`TrackId`, `SessionId`, etc.)
- Repository pattern: domain defines interfaces, infrastructure implements
- Max 300 lines per file
- No barrel files / re-exports

## Security Notes

- The server binds to `127.0.0.1` (localhost only) — not exposed to the network
- No authentication is required (local-first design — single-user)
- WebSocket input is sanitized before use in shell commands
- Database files (`.db`) and environment files (`.env`) are gitignored

## License

Private — not yet licensed for distribution.
