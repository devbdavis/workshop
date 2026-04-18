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

# Emits the PID launchd is tracking for the service, or nothing if absent.
# launchctl list <label> prints a plist-like block; the PID line is
#   "PID" = 12345;
# and is omitted when the service is loaded but not currently running.
launchd_pid() {
  launchctl list "$LAUNCHD_LABEL" 2>/dev/null \
    | awk -F'= ' '/"PID" =/ { gsub(/[^0-9]/, "", $2); print $2; exit }'
}

# True iff launchd is actively supervising a live PID. Used in place of
# is_running() on the launchd path because the server does not write the
# PID file itself — relying on $PID_FILE gives stale/false-negative results
# right after `launchctl kickstart -k`.
is_launchd_active() {
  local pid
  pid="$(launchd_pid)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

start() {
  if is_launchd_managed; then
    if is_launchd_active; then
      echo "Workshop server already running via launchd (PID $(launchd_pid))"
      return 0
    fi
    echo "Starting Workshop server via launchd..."
    launchctl kickstart "${LAUNCHD_DOMAIN}/${LAUNCHD_LABEL}"
    sleep 2
    if is_launchd_active; then
      echo "Server started (PID $(launchd_pid))"
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
    if is_launchd_active; then
      echo "Server restarted (PID $(launchd_pid))"
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
    if is_launchd_active; then
      pid_info=" (PID $(launchd_pid))"
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

# Regenerate the LaunchAgent plist and (re)load it into launchd. Writes the
# plist from the current repo checkout so paths, node binary and locale env
# vars stay correct after a re-clone or node upgrade. Safe to re-run.
install_launchd() {
  local node_bin tsx_bin server_entry node_dir locale
  node_bin="$(command -v node || true)"
  if [ -z "$node_bin" ]; then
    echo "Error: 'node' not found on PATH. Install node (or activate nvm) first." >&2
    return 1
  fi
  node_dir="$(dirname "$node_bin")"
  tsx_bin="$PROJECT_DIR/node_modules/.bin/tsx"
  server_entry="$PROJECT_DIR/src/server/index.ts"
  if [ ! -x "$tsx_bin" ]; then
    echo "Error: tsx not found at $tsx_bin. Run 'npm install' first." >&2
    return 1
  fi
  # Prefer en_US.UTF-8; fall back to C.UTF-8 if the system lacks it. A UTF-8
  # locale is required so tmux sessions (and the claude CLIs they host) render
  # box-drawing glyphs correctly. Without this, xterm.js shows replacement
  # characters where icons should appear.
  if locale -a 2>/dev/null | grep -qx 'en_US.UTF-8'; then
    locale='en_US.UTF-8'
  else
    locale='C.UTF-8'
  fi

  mkdir -p "$(dirname "$LAUNCHD_PLIST")"

  # Unload any prior instance so the new plist is picked up. bootout is a
  # no-op (non-zero exit) when the service isn't loaded — ignore that.
  launchctl bootout "${LAUNCHD_DOMAIN}/${LAUNCHD_LABEL}" 2>/dev/null || true

  cat > "$LAUNCHD_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${node_bin}</string>
        <string>${tsx_bin}</string>
        <string>${server_entry}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${PROJECT_DIR}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${WORKSHOP_DIR}/launchagent.log</string>
    <key>StandardErrorPath</key>
    <string>${WORKSHOP_DIR}/launchagent.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${node_dir}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>WORKSHOP_DB_PATH</key>
        <string>${DB_PATH}</string>
        <key>PORT</key>
        <string>${WORKSHOP_PORT}</string>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>LANG</key>
        <string>${locale}</string>
        <key>LC_CTYPE</key>
        <string>${locale}</string>
        <key>LC_ALL</key>
        <string>${locale}</string>
        <key>TERM</key>
        <string>xterm-256color</string>
    </dict>
</dict>
</plist>
PLIST

  launchctl bootstrap "${LAUNCHD_DOMAIN}" "$LAUNCHD_PLIST"
  launchctl enable "${LAUNCHD_DOMAIN}/${LAUNCHD_LABEL}"

  # Clear any stale PID file from a previous manual (nohup) run so status/
  # is_running don't get fooled after launchd takes over.
  rm -f "$PID_FILE"

  sleep 2
  if is_launchd_active; then
    echo "Installed ${LAUNCHD_LABEL} — running as PID $(launchd_pid)"
    echo "  Plist: $LAUNCHD_PLIST"
    echo "  Open:  http://localhost:$WORKSHOP_PORT"
  else
    echo "Installed ${LAUNCHD_LABEL} but it failed to start. Check $WORKSHOP_DIR/launchagent.log" >&2
    return 1
  fi
}

case "${1:-start}" in
  start)           start           ;;
  stop)            stop            ;;
  restart)         restart         ;;
  status)          status          ;;
  logs)            logs            ;;
  install-launchd) install_launchd ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|install-launchd}"
    exit 1
    ;;
esac
