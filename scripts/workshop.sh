#!/usr/bin/env bash
set -euo pipefail

WORKSHOP_DIR="$HOME/.workshop"
WORKSHOP_PORT="${WORKSHOP_PORT:-3002}"
DB_PATH="$WORKSHOP_DIR/workshop.db"
PID_FILE="$WORKSHOP_DIR/server.pid"
LOG_FILE="$WORKSHOP_DIR/server.log"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

LAUNCHD_LABEL="com.workshop.server"
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"
LAUNCHD_DOMAIN="gui/$(id -u)"

mkdir -p "$WORKSHOP_DIR"

# Fix node-pty spawn-helper permissions if needed
SPAWN_HELPER="$PROJECT_DIR/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper"
if [ -f "$SPAWN_HELPER" ] && [ ! -x "$SPAWN_HELPER" ]; then
  chmod +x "$SPAWN_HELPER"
fi

# Returns true if the service is loaded in launchd
is_launchd_managed() {
  [ -f "$LAUNCHD_PLIST" ] && launchctl list "$LAUNCHD_LABEL" &>/dev/null
}

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

start() {
  if is_launchd_managed; then
    if is_running; then
      echo "Workshop server already running via launchd (PID $(cat "$PID_FILE"))"
      return 0
    fi
    echo "Starting Workshop server via launchd..."
    launchctl kickstart "${LAUNCHD_DOMAIN}/${LAUNCHD_LABEL}"
    sleep 2
    if is_running; then
      echo "Server started (PID $(cat "$PID_FILE"))"
      echo "  Open: http://localhost:$WORKSHOP_PORT"
    else
      echo "Server failed to start. Check $HOME/.workshop/launchagent.log"
      return 1
    fi
    return 0
  fi

  if is_running; then
    echo "Workshop server already running (PID $(cat "$PID_FILE"))"
    return 0
  fi

  echo "Starting Workshop server..."
  echo "  DB:   $DB_PATH"
  echo "  Port: $WORKSHOP_PORT"
  echo "  Log:  $LOG_FILE"

  # Unset CLAUDECODE so spawned sessions can run Claude Code
  unset CLAUDECODE 2>/dev/null || true

  cd "$PROJECT_DIR"

  NODE_ENV=production \
    WORKSHOP_DB_PATH="$DB_PATH" \
    PORT="$WORKSHOP_PORT" \
    nohup npx tsx src/server/index.ts \
    >> "$LOG_FILE" 2>&1 &

  echo $! > "$PID_FILE"
  sleep 2

  if is_running; then
    echo "Server started (PID $(cat "$PID_FILE"))"
    AUTH_TOKEN_FILE="$WORKSHOP_DIR/auth-token"
    if [ -f "$AUTH_TOKEN_FILE" ]; then
      echo "  Auth: token at $AUTH_TOKEN_FILE"
    else
      echo "  Auth: token will be generated on first request"
    fi
    echo "  Open: http://localhost:$WORKSHOP_PORT"
  else
    echo "Server failed to start. Check $LOG_FILE"
    rm -f "$PID_FILE"
    return 1
  fi
}

stop() {
  if is_launchd_managed; then
    echo "Stopping Workshop server via launchd..."
    # bootout prevents KeepAlive from restarting the process
    launchctl bootout "${LAUNCHD_DOMAIN}/${LAUNCHD_LABEL}"
    rm -f "$PID_FILE"
    echo "Server stopped (launchd service unloaded)"
    return 0
  fi

  if ! is_running; then
    echo "Workshop server is not running"
    rm -f "$PID_FILE"
    return 0
  fi

  local pid
  pid=$(cat "$PID_FILE")
  echo "Stopping Workshop server (PID $pid)..."
  kill "$pid"

  # Wait up to 5 seconds for graceful shutdown
  for i in {1..10}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 0.5
  done

  # Force kill if still running
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid"
  fi

  rm -f "$PID_FILE"
  echo "Server stopped"
}

restart() {
  if is_launchd_managed; then
    echo "Restarting Workshop server via launchd..."
    # kickstart -k kills the running instance and starts a new one atomically
    launchctl kickstart -k "${LAUNCHD_DOMAIN}/${LAUNCHD_LABEL}"
    sleep 2
    if is_running; then
      echo "Server restarted (PID $(cat "$PID_FILE"))"
      echo "  Open: http://localhost:$WORKSHOP_PORT"
    else
      echo "Server failed to restart. Check $HOME/.workshop/launchagent.log"
      return 1
    fi
    return 0
  fi

  stop
  start
}

status() {
  if is_launchd_managed; then
    local pid_info=""
    if is_running; then
      pid_info=" (PID $(cat "$PID_FILE"))"
    fi
    echo "Workshop server is running via launchd${pid_info}"
    launchctl list "$LAUNCHD_LABEL"
    return 0
  fi

  if is_running; then
    echo "Workshop server is running (PID $(cat "$PID_FILE"))"
  else
    echo "Workshop server is not running"
    rm -f "$PID_FILE"
  fi
}

logs() {
  if [ -f "$LOG_FILE" ]; then
    tail -f "$LOG_FILE"
  else
    echo "No log file found at $LOG_FILE"
  fi
}

case "${1:-start}" in
  start)   start   ;;
  stop)    stop    ;;
  restart) restart ;;
  status)  status  ;;
  logs)    logs    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
