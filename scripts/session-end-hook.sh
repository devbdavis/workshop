#!/bin/bash
# Workshop SessionEnd hook — notifies the Workshop API when a Claude Code session ends.
# Claude Code sends session metadata on stdin as JSON.
# This script is referenced in the hooks settings written by the terminal manager.
#
# SessionEnd hooks have a 1.5s timeout by default, so keep this fast.

set -e

WORKSHOP_API_URL="${WORKSHOP_API_URL:-http://localhost:3002}"

# Read the full JSON payload from stdin
INPUT=$(cat)

# Extract session_id using lightweight parsing (avoid jq dependency)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null || echo "")

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Validate SESSION_ID is a safe UUID-like string (alphanumeric + hyphens only)
if ! echo "$SESSION_ID" | grep -qE '^[a-zA-Z0-9_-]+$'; then
  echo "session-end-hook: invalid session_id format, skipping" >&2
  exit 0
fi

# Fire-and-forget POST to Workshop (timeout after 1s to stay within hook budget)
# Use --data-raw to prevent shell interpretation of the session ID value
curl -s -m 1 -X POST "${WORKSHOP_API_URL}/api/hooks/session-end" \
  -H "Content-Type: application/json" \
  --data-raw "{\"session_id\": \"${SESSION_ID}\"}" \
  >/dev/null 2>&1 || true
