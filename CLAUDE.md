# Workshop

A local-first project command center for managing parallel work tracks with AI-assisted terminal sessions.

## Build & Run

```bash
npm run dev          # Start dev server (backend:3001 + Vite:5173)
npm run dev:server   # Backend only
npm run dev:client   # Frontend only
npm test             # Run all tests
npm run typecheck    # TypeScript check
npm run build        # Production build
```

## Architecture

Layered architecture with forward-only dependencies:

```
UI (React) → Application → Domain → Foundation
                  ↓
            Infrastructure (SQLite, Git, Terminal, MCP)
```

- `src/foundation/` — Shared types, branded IDs, config
- `src/domain/` — Business entities and repository interfaces
- `src/infrastructure/` — Adapters: persistence, git, terminal, MCP
- `src/application/` — Use cases and orchestration
- `src/ui/` — React frontend (Vite)
- `src/server/` — Express HTTP + WebSocket server

**Dependency rule**: No lower layer may import from a higher layer. Infrastructure implements domain interfaces but does not depend on application or UI.

## Tech Stack

- **Backend**: Node.js, Express, WebSocket (ws), SQLite (better-sqlite3), node-pty, tmux
- **Frontend**: React 19, Vite, Tailwind CSS v4, xterm.js
- **Language**: TypeScript (strict mode, ESM)
- **Testing**: Vitest

## Path Aliases

- `@foundation/*` → `src/foundation/*`
- `@domain/*` → `src/domain/*`
- `@infrastructure/*` → `src/infrastructure/*`
- `@application/*` → `src/application/*`
- `@server/*` → `src/server/*`
- `@ui/*` → `src/ui/*`

## Key Files

- `src/server/index.ts` — Server entry point
- `src/server/api.ts` — REST API routes
- `src/server/websocket.ts` — Terminal WebSocket bridge
- `src/infrastructure/terminal/manager.ts` — tmux session lifecycle
- `src/infrastructure/persistence/database.ts` — SQLite schema + migrations

## Production Server

```bash
scripts/workshop.sh start    # Start prod (port 3002, DB ~/.workshop/workshop.db)
scripts/workshop.sh stop
scripts/workshop.sh restart  # After backend code changes
scripts/workshop.sh status
```

Dev and prod can run simultaneously (dev: 3001, prod: 3002).

## Workshop Skills

There are two skill directories in this repo, and they are not interchangeable:

- **`templates/skills/<slug>/SKILL.md`** — installable templates. These appear in Settings → Skills as install cards, and installing copies the skill into `~/.claude/skills/`. **This is where new skills go.**
- **`skills/<name>/SKILL.md`** — the older symlink convention, kept for skills already wired up that way. Do not add to it.

To create a new workshop skill:

1. Create the directory and file: `mkdir -p templates/skills/<slug> && touch templates/skills/<slug>/SKILL.md`
2. Edit the frontmatter — `name` and `description` (include `Tagged: workshop.`). Only `name`, `description`, `allowed-tools`, `compatibility`, `license`, and `metadata` are valid keys; the install flow takes the template slug from the directory name, so do not add a `templateName` key (some older templates carry one — it is inert and fails validation)
3. Package/validate: `cd ~/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator && python3 -m scripts.package_skill <abs-path-to-skill-dir>`

The template list is read from disk per request (`GET /api/skills/templates`), so a merged skill shows up without restarting the server. Nothing needs symlinking.

**Important**: Skills must be a directory containing `SKILL.md`, not a flat `<skill-name>.md` file.

## Conventions

- ESM imports throughout (`import`, not `require`)
- Branded string types for IDs (TrackId, SessionId, etc.)
- Repository pattern: domain defines interfaces, infrastructure implements
- Max 300 lines per file
- No barrel files / re-exports
