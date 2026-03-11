---
name: workshop-server
description: "Manage the Workshop production server (start, stop, restart, status, logs). This skill should be used when the user asks to start, stop, restart, or check the workshop server, or when a server restart is needed after code changes to backend files. Tagged: workshop."
---

# Workshop Server Management

Manage the Workshop production server running at `~/.workshop/` with a persistent SQLite database separate from the development environment.

## Architecture

- **Production server**: Port 3002 (default), DB at `~/.workshop/workshop.db`, managed via `scripts/workshop.sh`
- **Dev server**: Port 3001 + Vite on 5173, DB at `./workshop.db` in the project root
- **tmux sessions**: Survive server restarts (they are independent processes)

## Commands

The management script lives in the workshop project:

```
/Users/fabian.haupt/projects/workshop/scripts/workshop.sh {start|stop|restart|status|logs}
```

### Start

```bash
/Users/fabian.haupt/projects/workshop/scripts/workshop.sh start
```

### Stop

```bash
/Users/fabian.haupt/projects/workshop/scripts/workshop.sh stop
```

### Restart

```bash
/Users/fabian.haupt/projects/workshop/scripts/workshop.sh restart
```

Use restart after making code changes to `src/server/` or `src/infrastructure/` that affect the backend.

**After frontend changes**: You must also rebuild the production client before restarting:

```bash
cd /Users/fabian.haupt/projects/workshop && npm run build && /Users/fabian.haupt/projects/workshop/scripts/workshop.sh restart
```

The production server serves static files from `dist/client/`. If you only restart without rebuilding, the UI will be stale.

### Status

```bash
/Users/fabian.haupt/projects/workshop/scripts/workshop.sh status
```

### View Logs

```bash
tail -50 ~/.workshop/server.log
```

Use `tail` rather than `scripts/workshop.sh logs` (which uses `tail -f` and blocks).

## Verification

After starting or restarting, verify the server is healthy:

```bash
curl -s http://localhost:3002/api/tracks | head -c 200
```

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `WORKSHOP_PORT` | `3002` | Server listen port |
| `WORKSHOP_DB_PATH` | `~/.workshop/workshop.db` | SQLite database path |

## Key Files

- `~/.workshop/workshop.db` — Production database (persistent, survives restarts)
- `~/.workshop/server.pid` — PID file for stop/restart
- `~/.workshop/server.log` — Server stdout/stderr log

## Important Notes

- The production server runs outside Claude session context (unsets `CLAUDECODE` env var) so spawned Claude sessions work correctly.
- Terminal/tmux sessions survive server restarts. Only the WebSocket connections briefly drop and auto-reconnect.
- The production DB at `~/.workshop/workshop.db` is separate from the dev DB at `./workshop.db`. Data does not automatically sync between them.
