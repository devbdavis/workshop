#!/bin/bash
# Workshop PreToolUse hook — gates background agent tool use through Workshop UI.
# Blocks until the user approves or denies in the Workshop permission panel.
#
# Workshop long-polls the decision internally (up to 24h); this script simply
# waits for the HTTP response and translates it to Claude Code's exit convention:
#   exit 0 → allow the tool call
#   exit 2 → block it (reason written to stdout as JSON)
#
# On any error (curl failure, parse failure, server unreachable), we allow by
# default so agents are not permanently stuck.

WORKSHOP_API_URL="${WORKSHOP_API_URL:-http://localhost:3002}"
SESSION_ID="${WORKSHOP_SESSION_ID:-}"

if [ -z "$SESSION_ID" ]; then
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

AUTH_HEADER=""
if [ -n "$AUTH_TOKEN" ]; then
  AUTH_HEADER="-H \"Authorization: Bearer ${AUTH_TOKEN}\""
fi

# Blocking POST — no -m timeout since Workshop long-polls until user decides
RESPONSE=$(eval curl -s -X POST "${WORKSHOP_API_URL}/api/hooks/permission" \
  -H "Content-Type: application/json" \
  -H "X-Workshop-Session: ${SESSION_ID}" \
  $AUTH_HEADER \
  --data-raw "${INPUT}" 2>/dev/null) || {
  # curl failed — allow so agent isn't stuck
  exit 0
}

# Parse decision from Workshop response
DECISION=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    output = data.get('hookSpecificOutput', {})
    print(output.get('permissionDecision', 'allow'))
except Exception:
    print('allow')
" 2>/dev/null || echo "allow")

if [ "$DECISION" = "deny" ]; then
  REASON=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    output = data.get('hookSpecificOutput', {})
    reason = output.get('permissionDecisionReason', 'Operation denied by Workshop')
    # Escape for JSON string
    print(json.dumps(reason))
except Exception:
    print('\"Operation denied by Workshop\"')
" 2>/dev/null || echo '"Operation denied by Workshop"')
  echo "{\"reason\": ${REASON}}"
  exit 2
fi

exit 0
