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

Workshop skills live in `skills/` in this repo and are symlinked to `~/.claude/skills/`. To create a new workshop skill:

1. Create the skill directory and file: `mkdir -p skills/<skill-name> && touch skills/<skill-name>/SKILL.md`
2. Edit `skills/<skill-name>/SKILL.md` — include `Tagged: workshop.` in the description
3. Package/validate: `python3 ~/.claude/plugins/marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator/scripts/package_skill.py skills/<skill-name>`
4. Symlink: `ln -s $(pwd)/skills/<skill-name> ~/.claude/skills/<skill-name>`

**Important**: Skills must be a directory containing `SKILL.md`, not a flat `<skill-name>.md` file.

All workshop skills are tracked in git under `skills/`.

## Conventions

- ESM imports throughout (`import`, not `require`)
- Branded string types for IDs (TrackId, SessionId, etc.)
- Repository pattern: domain defines interfaces, infrastructure implements
- Max 300 lines per file
- No barrel files / re-exports
