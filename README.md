# Workshop

> *This is my Workshop. There are many like it, but this one is mine.*
> *My Workshop is my best friend. It is my life. I must master it as I must master my life.*
> *Without me, my Workshop is useless. Without my Workshop, I am useless.*
>
> — Fab's Work Orchestration Creed

A local-first project command center for managing parallel work tracks with AI-assisted terminal sessions.

Workshop lets you organize development work into **tracks** — each with linked repos, terminal sessions, AI-generated summaries, and a workflow ticket pipeline. It provides a web UI for managing everything from a single dashboard, and an MCP server so Claude Code can interact with your tracks programmatically.

## Prerequisites

- **Node.js >= 22** (see `.nvmrc`)
- **tmux** — required for terminal session management
- **Claude Code CLI** (`claude`) — for AI-assisted terminal sessions
- **macOS or Linux** — node-pty requires a Unix environment

### Install system dependencies

```bash
# macOS
brew install tmux

# Ubuntu/Debian
sudo apt-get install tmux
```

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

2. Add the MCP server to your Claude Code config (`~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "workshop": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server.ts"],
      "cwd": "/path/to/workshop",
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

Workshop includes [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) for AI-assisted server management and MCP interaction. To install them:

```bash
# Symlink skills into your Claude Code skills directory
ln -s "$(pwd)/skills/workshop-server" ~/.claude/skills/workshop-server
ln -s "$(pwd)/skills/workshop-mcp" ~/.claude/skills/workshop-mcp
```

After symlinking, Claude Code will automatically discover and use these skills when relevant.

## Key Concepts

### Tracks
A track represents a parallel work stream — a project, feature, or investigation. Each track has linked repos, terminal sessions, context, summaries, and workflow tickets.

### Sessions
Terminal sessions are tmux-backed, with optional Claude Code or Codex CLI integration. Sessions survive server restarts. The system auto-composes a context-rich system prompt for each new AI session from the track's context, vault memory, and latest summary.

### Workflow Tickets
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
