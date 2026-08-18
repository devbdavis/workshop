#!/usr/bin/env bash
# Fetches every repo under the Workshop repo root and fast-forwards clean
# main/master checkouts. Repos with local work are fetched only, so a later
# `git checkout origin/main` still sees fresh refs.
#
# Root resolution: $1 → $SYNC_REPOS_ROOT → Workshop's repo_root setting → ~/repos

set -uo pipefail

# Never hang a scheduled run on an unreachable host or a credential prompt.
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o ConnectTimeout=10 -o BatchMode=yes}"
export GIT_TERMINAL_PROMPT=0

WORKSHOP_DB="$HOME/.workshop/workshop.db"
REPO_ROOT="${1:-${SYNC_REPOS_ROOT:-}}"
if [[ -z "$REPO_ROOT" && -f "$WORKSHOP_DB" ]]; then
  REPO_ROOT=$(sqlite3 "$WORKSHOP_DB" "SELECT value FROM settings WHERE key='repo_root';" 2>/dev/null || true)
fi
REPO_ROOT="${REPO_ROOT:-$HOME/repos}"
REPO_ROOT="${REPO_ROOT/#\~/$HOME}"

[[ -d "$REPO_ROOT" ]] || { echo "[sync-repos] repo root not found: $REPO_ROOT"; exit 1; }
echo "[sync-repos] root: $REPO_ROOT"

failed=0

for dir in "$REPO_ROOT"/*/; do
  repo="${dir%/}"
  name=$(basename "$repo")

  git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || continue
  git -C "$repo" remote get-url origin >/dev/null 2>&1 || { echo "  $name: no origin, skipped"; continue; }

  if ! git -C "$repo" fetch --prune --quiet origin; then
    echo "  $name: FETCH FAILED"
    failed=1
    continue
  fi

  # Default branch from origin/HEAD, falling back to whichever of main/master exists
  default=$(git -C "$repo" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)
  default="${default#origin/}"
  if [[ -z "$default" ]]; then
    for b in main master; do
      git -C "$repo" rev-parse --verify --quiet "refs/remotes/origin/$b" >/dev/null && { default="$b"; break; }
    done
  fi
  [[ -n "$default" ]] || { echo "  $name: no main/master on origin, fetched only"; continue; }

  branch=$(git -C "$repo" symbolic-ref --quiet --short HEAD 2>/dev/null || echo "(detached)")
  if [[ "$branch" != "$default" ]]; then
    echo "  $name: on $branch, fetched only"
    continue
  fi
  if [[ -n $(git -C "$repo" status --porcelain) ]]; then
    echo "  $name: local changes, fetched only"
    continue
  fi

  before=$(git -C "$repo" rev-parse --short HEAD)
  if git -C "$repo" merge --ff-only --quiet "origin/$default" 2>/dev/null; then
    after=$(git -C "$repo" rev-parse --short HEAD)
    if [[ "$before" == "$after" ]]; then
      echo "  $name: $default up to date"
    else
      echo "  $name: $default $before -> $after"
    fi
  else
    echo "  $name: $default diverged from origin, fetched only"
  fi
done

echo "[sync-repos] done"
exit "$failed"
