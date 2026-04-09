#!/usr/bin/env bash
# Workshop MCP server launcher — resolves repo path from BASH_SOURCE so it
# works regardless of the caller's working directory (e.g. Workshop sessions
# whose cwd is a workspace dir, not the repo root).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec /nix/var/nix/profiles/default/bin/nix develop "${REPO_DIR}" \
  --command npx tsx "${REPO_DIR}/src/mcp/server.ts"
