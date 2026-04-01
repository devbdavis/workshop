#!/bin/bash
# Workshop SessionEnd hook — notifies the Workshop API when a Claude Code session ends.
# Called for ALL sessions with permission hooks (not just workflow executions).
#
# The Workshop session ID is passed via WORKSHOP_SESSION_ID env var (set in the
# hook command by the terminal manager). Claude Code also sends session metadata
# on stdin as JSON, but the env var is more reliable.
#
# SessionEnd hooks have a 1.5s timeout by default, so keep this fast.

set -e

WORKSHOP_API_URL="${WORKSHOP_API_URL:-http://localhost:3002}"

# Read auth token for API authentication
AUTH_TOKEN=""
AUTH_TOKEN_FILE="$HOME/.workshop/auth-token"
if [ -n "${WORKSHOP_AUTH_TOKEN:-}" ]; then
  AUTH_TOKEN="$WORKSHOP_AUTH_TOKEN"
elif [ -f "$AUTH_TOKEN_FILE" ]; then
  AUTH_TOKEN=$(cat "$AUTH_TOKEN_FILE")
fi

# Prefer env var; fall back to parsing stdin for backward compat
SESSION_ID="${WORKSHOP_SESSION_ID:-}"

if [ -z "$SESSION_ID" ]; then
  INPUT=$(cat)
  SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null || echo "")
fi

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Validate SESSION_ID is a safe UUID-like string (alphanumeric + hyphens only)
if ! echo "$SESSION_ID" | grep -qE '^[a-zA-Z0-9_-]+$'; then
  echo "session-end-hook: invalid session_id format, skipping" >&2
  exit 0
fi

# Fire-and-forget POST to Workshop (timeout after 1s to stay within hook budget)
CURL_ARGS=(-s -m 1 -X POST "${WORKSHOP_API_URL}/api/hooks/session-end"
  -H "Content-Type: application/json"
  -H "X-Workshop-Session: ${SESSION_ID}"
  --data-raw "{\"session_id\": \"${SESSION_ID}\"}")
if [ -n "$AUTH_TOKEN" ]; then
  CURL_ARGS+=(-H "Authorization: Bearer ${AUTH_TOKEN}")
fi
curl "${CURL_ARGS[@]}" >/dev/null 2>&1 || true
