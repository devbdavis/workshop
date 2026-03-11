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

## Conventions

- ESM imports throughout (`import`, not `require`)
- Branded string types for IDs (TrackId, SessionId, etc.)
- Repository pattern: domain defines interfaces, infrastructure implements
- Max 300 lines per file
- No barrel files / re-exports
