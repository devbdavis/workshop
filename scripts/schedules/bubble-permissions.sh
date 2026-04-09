#!/usr/bin/env bash
# Promotes approved Claude Code permissions across three targets:
#   1. ~/.claude/settings.json          — user-level global allow list
#   2. <source-repo>/.claude/settings.json — source repo for each active worktree
#   3. <workspace>/.claude/settings.json  — merged workspace settings (regenerated)
#
# Sources scanned: settings.local.json, Workshop worktrees, ~/repos/

set -euo pipefail

USER_SETTINGS="$HOME/.claude/settings.json"
LOCAL_SETTINGS="$HOME/.claude/settings.local.json"
WORKSHOP_DB="$HOME/.workshop/workshop.db"

log() { echo "[bubble-permissions] $*"; }

get_allows() {
  [[ -f "$1" ]] && jq -r '.permissions.allow // [] | .[]' "$1" 2>/dev/null || true
}

# Append new_json (JSON array) into a settings file's permissions.allow.
# Preserves existing order; creates the file if absent.
merge_allows_into_file() {
  local file="$1"
  local new_json="$2"
  if [[ -f "$file" ]]; then
    jq --argjson new "$new_json" \
      '.permissions.allow = (
        (.permissions.allow // []) as $existing |
        $existing + ($new | map(select(. as $e | ($existing | map(. == $e) | any) | not)))
      )' \
      "$file" > "${file}.bubble.tmp" && mv "${file}.bubble.tmp" "$file"
  else
    mkdir -p "$(dirname "$file")"
    jq -n --argjson allows "$new_json" '{"permissions":{"allow":$allows}}' > "$file"
  fi
}

[[ -f "$USER_SETTINGS" ]] || { log "No user settings at $USER_SETTINGS — aborting"; exit 0; }

# ─── PHASE 1: Collect candidates ────────────────────────────────────────────

candidates=$(mktemp)
trap 'rm -f "$candidates"' EXIT

get_allows "$LOCAL_SETTINGS" >> "$candidates"

active_roots=()
if [[ -f "$WORKSHOP_DB" ]]; then
  while IFS= read -r root; do
    [[ -n "$root" ]] || continue
    active_roots+=("$root")
    while IFS= read -r f; do
      get_allows "$f" >> "$candidates"
    done < <(find "$root" -maxdepth 5 -name "settings.json" -path "*/.claude/*" 2>/dev/null)
  done < <(sqlite3 "$WORKSHOP_DB" \
    "SELECT DISTINCT worktree_root FROM sessions WHERE deleted_at IS NULL AND worktree_root IS NOT NULL AND worktree_root != '';" \
    2>/dev/null || true)
fi

while IFS= read -r f; do
  get_allows "$f" >> "$candidates"
done < <(find "$HOME/repos" -maxdepth 3 -name "settings.json" -path "*/.claude/*" 2>/dev/null || true)

# ─── PHASE 2: Bubble to user-level settings.json ────────────────────────────

new_for_user=$(mktemp)
trap 'rm -f "$candidates" "$new_for_user"' EXIT

sort -u "$candidates" | while IFS= read -r entry; do
  [[ -n "$entry" ]] || continue
  get_allows "$USER_SETTINGS" | grep -qxF "$entry" || echo "$entry"
done > "$new_for_user"

user_count=$(wc -l < "$new_for_user" | tr -d ' ')
if [[ "$user_count" -gt 0 ]]; then
  log "Promoting $user_count permission(s) to user settings:"
  while IFS= read -r e; do log "  + $e"; done < "$new_for_user"
  new_json=$(jq -R . "$new_for_user" | jq -s .)
  merge_allows_into_file "$USER_SETTINGS" "$new_json"
  log "Updated $USER_SETTINGS"
else
  log "User settings: nothing new"
fi

# ─── PHASE 3: Prune settings.local.json ─────────────────────────────────────

if [[ -f "$LOCAL_SETTINGS" ]]; then
  local_count=$(get_allows "$LOCAL_SETTINGS" | wc -l | tr -d ' ')
  if [[ "$local_count" -gt 0 ]]; then
    remaining=$(get_allows "$LOCAL_SETTINGS" | sort -u | while IFS= read -r entry; do
      get_allows "$USER_SETTINGS" | grep -qxF "$entry" || echo "$entry"
    done)
    if [[ -z "$remaining" ]]; then
      jq 'del(.permissions.allow) | if ((.permissions // {}) | keys | length) == 0 then del(.permissions) else . end' \
        "$LOCAL_SETTINGS" > "${LOCAL_SETTINGS}.bubble.tmp" && mv "${LOCAL_SETTINGS}.bubble.tmp" "$LOCAL_SETTINGS"
      log "Cleared settings.local.json"
    else
      keeps=$(echo "$remaining" | jq -R . | jq -s .)
      jq --argjson keeps "$keeps" '.permissions.allow = $keeps' \
        "$LOCAL_SETTINGS" > "${LOCAL_SETTINGS}.bubble.tmp" && mv "${LOCAL_SETTINGS}.bubble.tmp" "$LOCAL_SETTINGS"
      log "Pruned settings.local.json"
    fi
  fi
fi

# ─── PHASE 4: Bubble to source repos ────────────────────────────────────────

for root in "${active_roots[@]+"${active_roots[@]}"}"; do
  meta="$root/.worktree-meta.json"
  [[ -f "$meta" ]] || continue

  while IFS= read -r repo_path; do
    [[ -n "$repo_path" ]] || continue
    repo_name=$(basename "$repo_path")
    worktree_settings="$root/$repo_name/.claude/settings.json"
    source_settings="$repo_path/.claude/settings.json"

    [[ -f "$worktree_settings" ]] || continue

    new_for_repo=$(get_allows "$worktree_settings" | sort -u | while IFS= read -r entry; do
      [[ -n "$entry" ]] || continue
      if [[ -f "$source_settings" ]]; then
        get_allows "$source_settings" | grep -qxF "$entry" || echo "$entry"
      else
        echo "$entry"
      fi
    done)

    [[ -n "$new_for_repo" ]] || continue

    repo_count=$(echo "$new_for_repo" | wc -l | tr -d ' ')
    log "Bubbling $repo_count permission(s) to $repo_name:"
    echo "$new_for_repo" | while IFS= read -r e; do log "  → $e"; done

    new_json=$(echo "$new_for_repo" | jq -R . | jq -s .)
    merge_allows_into_file "$source_settings" "$new_json"
    log "Updated $source_settings"

  done < <(jq -r '.repos[].path' "$meta" 2>/dev/null || true)
done

# ─── PHASE 5: Regenerate workspace .claude/settings.json ────────────────────

for root in "${active_roots[@]+"${active_roots[@]}"}"; do
  meta="$root/.worktree-meta.json"
  [[ -f "$meta" ]] || continue

  # Collect source repo settings files that exist
  source_files=()
  while IFS= read -r repo_path; do
    [[ -n "$repo_path" ]] || continue
    [[ -f "$repo_path/.claude/settings.json" ]] && source_files+=("$repo_path/.claude/settings.json")
  done < <(jq -r '.repos[].path' "$meta" 2>/dev/null || true)

  [[ ${#source_files[@]} -eq 0 ]] && continue

  # Merge permissions.allow from all source repos
  allows_tmp=$(mktemp)
  for f in "${source_files[@]}"; do
    get_allows "$f" >> "$allows_tmp"
  done

  [[ -s "$allows_tmp" ]] || { rm -f "$allows_tmp"; continue; }

  allows_json=$(sort -u "$allows_tmp" | jq -R . | jq -s .)
  rm -f "$allows_tmp"

  # Merge env from all source repos (later repos override earlier on conflict)
  merged_env=$(jq -s 'map(select(.env != null) | .env) | if length > 0 then reduce .[] as $e ({}; . * $e) else {} end' \
    "${source_files[@]}" 2>/dev/null || echo '{}')

  workspace_settings="$root/.claude/settings.json"
  mkdir -p "$root/.claude"

  if [[ "$merged_env" != '{}' ]]; then
    jq -n --argjson allows "$allows_json" --argjson env "$merged_env" \
      '{"permissions":{"allow":$allows},"env":$env}' > "$workspace_settings"
  else
    jq -n --argjson allows "$allows_json" \
      '{"permissions":{"allow":$allows}}' > "$workspace_settings"
  fi

  log "Regenerated workspace settings: $workspace_settings"

  # Write .code-workspace if absent (created by manager.ts for new sessions;
  # this backfills existing workspaces)
  code_workspace="$root/workspace.code-workspace"
  if [[ ! -f "$code_workspace" ]]; then
    folders_json=$(jq -r '.repos[].name' "$meta" 2>/dev/null | jq -R '{"path":.,"name":.}' | jq -s '.')
    jq -n --argjson folders "$folders_json" '{"folders":$folders,"settings":{}}' > "$code_workspace"
    log "Created $code_workspace"
  fi
done

log "Done"
