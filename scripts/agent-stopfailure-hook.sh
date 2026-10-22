#!/bin/bash
# Workshop StopFailure hook — fires when a turn ends due to an API error.
# Used (matcher: rate_limit) to detect when an autonomous run hits the Claude
# usage wall, so Workshop can calibrate the usage ceiling and pause the run
# until the window resets.
#
# WORKSHOP_SESSION_ID / WORKSHOP_ISSUE_ID are baked into the hook command by
# the terminal manager. Claude Code sends the failure payload on stdin as JSON
# (fields include `error` and `last_assistant_message`).

WORKSHOP_API_URL="${WORKSHOP_API_URL:-http://localhost:3002}"
SESSION_ID="${WORKSHOP_SESSION_ID:-}"
ISSUE_ID="${WORKSHOP_ISSUE_ID:-}"

if [ -z "$SESSION_ID" ] || [ -z "$ISSUE_ID" ]; then
  exit 0
fi

AUTH_TOKEN=""
AUTH_TOKEN_FILE="$HOME/.workshop/auth-token"
if [ -n "${WORKSHOP_AUTH_TOKEN:-}" ]; then
  AUTH_TOKEN="$WORKSHOP_AUTH_TOKEN"
elif [ -f "$AUTH_TOKEN_FILE" ]; then
  AUTH_TOKEN=$(cat "$AUTH_TOKEN_FILE")
fi

INPUT=$(cat)

CURL_ARGS=(-s -m 5 -X POST "${WORKSHOP_API_URL}/api/hooks/stop-failure"
  -H "Content-Type: application/json"
  -H "X-Workshop-Session: ${SESSION_ID}"
  -H "X-Workshop-Issue: ${ISSUE_ID}"
  --data-raw "${INPUT}")
if [ -n "$AUTH_TOKEN" ]; then
  CURL_ARGS+=(-H "Authorization: Bearer ${AUTH_TOKEN}")
fi
curl "${CURL_ARGS[@]}" >/dev/null 2>&1 || true
