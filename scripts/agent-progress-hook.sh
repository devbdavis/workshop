#!/bin/bash
# Workshop SubagentStop hook — tracks sub-agent completion for workflow execution.
# Called when a Task-spawned sub-agent finishes, so Workshop can update ticket
# progress and drive workflow state machines forward.
#
# WORKSHOP_SESSION_ID and WORKSHOP_TICKET_ID are passed via env vars set in the
# hook command by the terminal manager. Claude Code sends subagent metadata on
# stdin as JSON.

WORKSHOP_API_URL="${WORKSHOP_API_URL:-http://localhost:3002}"
SESSION_ID="${WORKSHOP_SESSION_ID:-}"
TICKET_ID="${WORKSHOP_TICKET_ID:-}"

if [ -z "$SESSION_ID" ] || [ -z "$TICKET_ID" ]; then
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

INPUT=$(cat)

# Fire-and-forget POST to Workshop (5s timeout)
CURL_ARGS=(-s -m 5 -X POST "${WORKSHOP_API_URL}/api/hooks/agent-progress"
  -H "Content-Type: application/json"
  -H "X-Workshop-Session: ${SESSION_ID}"
  -H "X-Workshop-Ticket: ${TICKET_ID}"
  --data-raw "${INPUT}")
if [ -n "$AUTH_TOKEN" ]; then
  CURL_ARGS+=(-H "Authorization: Bearer ${AUTH_TOKEN}")
fi
curl "${CURL_ARGS[@]}" >/dev/null 2>&1 || true
