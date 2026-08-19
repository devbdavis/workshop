#!/usr/bin/env bash
# Fetches every repo under the Workshop repo root and fast-forwards clean
# main/master checkouts. Repos with local work are fetched only, so a later
# `git checkout origin/main` still sees fresh refs.
#
# Repo root, first match wins: $1, $SYNC_REPOS_ROOT, Workshop's repo_root setting.

set -uo pipefail

# Never hang a scheduled run: bound the connect, drop an SSH session that goes
# silent mid-transfer, and fail instead of prompting for credentials.
export GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o ConnectTimeout=10 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -o BatchMode=yes}"
export GIT_TERMINAL_PROMPT=0

# Same bound for HTTPS remotes: abort a transfer stuck under 1 KB/s for a minute.
git_fetch() {
  git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 "$@"
}

WORKSHOP_DB="$HOME/.workshop/workshop.db"
REPO_ROOT="${1:-${SYNC_REPOS_ROOT:-}}"
if [[ -z "$REPO_ROOT" && -f "$WORKSHOP_DB" ]]; then
  REPO_ROOT=$(sqlite3 "$WORKSHOP_DB" "SELECT value FROM settings WHERE key='repo_root';" 2>/dev/null || true)
fi
REPO_ROOT="${REPO_ROOT/#\~/$HOME}"

[[ -n "$REPO_ROOT" ]] || { echo "[sync-repos] no repo root: pass one as \$1 or set SYNC_REPOS_ROOT"; exit 1; }
[[ -d "$REPO_ROOT" ]] || { echo "[sync-repos] repo root not found: $REPO_ROOT"; exit 1; }

err=$(mktemp)
trap 'rm -f "$err"' EXIT

default_branch() {
  local repo="$1" d
  d=$(git -C "$repo" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)
  d="${d#origin/}"
  if [[ -z "$d" ]]; then
    for b in main master; do
      git -C "$repo" rev-parse --verify --quiet "refs/remotes/origin/$b" >/dev/null && { d="$b"; break; }
    done
  fi
  printf '%s' "$d"
}

# Retries with backoff, since SSH connect timeouts to the forge are common and
# almost always transient, then falls back to fetching just the default branch:
# some remotes carry refs a case-insensitive filesystem cannot store, and that
# one ref is all this script needs.
fetch_repo() {
  local repo="$1" default="$2" attempt
  for attempt in 1 2; do
    git_fetch -C "$repo" fetch --prune --quiet origin 2>"$err" && return 0
    sleep 5
  done
  # Port 22 to github.com is blocked or throttled on some networks; GitHub
  # serves SSH on 443 for exactly this case.
  if [[ "$(git -C "$repo" remote get-url origin)" == *github.com* ]]; then
    GIT_SSH_COMMAND="$GIT_SSH_COMMAND -o Hostname=ssh.github.com -o Port=443 -o StrictHostKeyChecking=accept-new" \
      git_fetch -C "$repo" fetch --prune --quiet origin 2>"$err" && return 0
  fi
  [[ -n "$default" ]] || return 1
  git_fetch -C "$repo" fetch --no-tags --quiet origin "+refs/heads/$default:refs/remotes/origin/$default" 2>"$err"
}

echo "[sync-repos] root: $REPO_ROOT"
failed=0

for dir in "$REPO_ROOT"/*/; do
  repo="${dir%/}"
  name=$(basename "$repo")

  git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || continue
  git -C "$repo" remote get-url origin >/dev/null 2>&1 || { echo "  $name: no origin, skipped"; continue; }

  default=$(default_branch "$repo")
  if ! fetch_repo "$repo" "$default"; then
    echo "  $name: FETCH FAILED — $(grep -v '^$' "$err" | head -1)"
    failed=1
    continue
  fi
  [[ -n "$default" ]] || default=$(default_branch "$repo")
  [[ -n "$default" ]] || { echo "  $name: no main/master on origin, fetched only"; continue; }

  branch=$(git -C "$repo" symbolic-ref --quiet --short HEAD 2>/dev/null || echo "(detached)")
  if [[ "$branch" != "$default" ]]; then
    echo "  $name: on $branch, origin/$default now $(git -C "$repo" rev-parse --short "origin/$default")"
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
      echo "  $name: $default up to date at $after"
    else
      echo "  $name: $default $before -> $after"
    fi
  else
    echo "  $name: $default diverged from origin, fetched only"
  fi
done

echo "[sync-repos] done"
exit "$failed"
