#!/bin/bash
# Workshop SessionStart hook — captures Claude's session ID for --resume support.
# Called for ALL sessions so Workshop can resume them after a server restart.
#
# The Workshop session ID is passed via WORKSHOP_SESSION_ID env var (set in the
# hook command by the terminal manager). Claude Code sends session metadata on
# stdin as JSON, including the session_id we need to capture.

WORKSHOP_API_URL="${WORKSHOP_API_URL:-http://localhost:3002}"
SESSION_ID="${WORKSHOP_SESSION_ID:-}"

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Validate SESSION_ID is a safe UUID-like string
if ! echo "$SESSION_ID" | grep -qE '^[a-zA-Z0-9_-]+$'; then
  echo "session-start-hook: invalid session_id format, skipping" >&2
  exit 0
fi

# Read auth token
AUTH_TOKEN=""
AUTH_TOKEN_FILE="$HOME/.workshop/auth-token"
if [ -n "${WORKSHOP_AUTH_TOKEN:-}" ]; then
  AUTH_TOKEN="$WORKSHOP_AUTH_TOKEN"
elif [ -f "$AUTH_TOKEN_FILE" ]; then
  AUTH_TOKEN=$(cat "$AUTH_TOKEN_FILE")
fi

# Read stdin — Claude Code pipes session metadata as JSON (contains session_id).
# Use read -t so we don't block indefinitely if:
#   - stdin is a terminal (manual invocation), or
#   - Claude Code opens a pipe but doesn't close it promptly on some platforms.
INPUT=''
while IFS= read -r -t 2 line; do
  INPUT="${INPUT}${line}"
done
[ -z "$INPUT" ] && INPUT='{}'

# Fire-and-forget POST to Workshop (5s timeout)
CURL_ARGS=(-s -m 5 -X POST "${WORKSHOP_API_URL}/api/hooks/session-start"
  -H "Content-Type: application/json"
  -H "X-Workshop-Session: ${SESSION_ID}"
  --data-raw "${INPUT}")
if [ -n "$AUTH_TOKEN" ]; then
  CURL_ARGS+=(-H "Authorization: Bearer ${AUTH_TOKEN}")
fi
curl "${CURL_ARGS[@]}" >/dev/null 2>&1 || true
