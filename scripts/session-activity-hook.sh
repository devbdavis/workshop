#!/bin/bash
# Workshop activity hook — reports working/idle/needs-input instantly from Claude Code hooks.
# Status is passed as $1; stdin is intentionally not read so Claude is never blocked.

WORKSHOP_API_URL="${WORKSHOP_API_URL:-http://localhost:3002}"
SESSION_ID="${WORKSHOP_SESSION_ID:-}"
STATUS="${1:-}"

case "$STATUS" in
  working|idle|needs-input) ;;
  *) exit 0 ;;
esac

[ -z "$SESSION_ID" ] && exit 0
echo "$SESSION_ID" | grep -qE '^[a-zA-Z0-9_-]+$' || exit 0

AUTH_TOKEN=""
AUTH_TOKEN_FILE="$HOME/.workshop/auth-token"
if [ -n "${WORKSHOP_AUTH_TOKEN:-}" ]; then
  AUTH_TOKEN="$WORKSHOP_AUTH_TOKEN"
elif [ -f "$AUTH_TOKEN_FILE" ]; then
  AUTH_TOKEN=$(cat "$AUTH_TOKEN_FILE")
fi

CURL_ARGS=(-s -m 2 -X POST "${WORKSHOP_API_URL}/api/hooks/activity"
  -H "Content-Type: application/json"
  -H "X-Workshop-Session: ${SESSION_ID}"
  --data-raw "{\"status\":\"${STATUS}\"}")
if [ -n "$AUTH_TOKEN" ]; then
  CURL_ARGS+=(-H "Authorization: Bearer ${AUTH_TOKEN}")
fi
curl "${CURL_ARGS[@]}" >/dev/null 2>&1 || true
exit 0
