#!/usr/bin/env bash
# Workshop container entrypoint.
#   - starts the Nix daemon (so agent sessions can build flakes)
#   - prepares persistent state under $HOME (/config)
#   - optionally drops privileges to PUID:PGID (unraid convention)
#   - execs the server (passed as CMD)
set -euo pipefail

PUID="${PUID:-0}"
PGID="${PGID:-0}"

# --- Nix daemon ------------------------------------------------------------
# Multi-user Nix needs the daemon running for non-root clients to build/realise
# derivations. --init none skipped starting it, so we start it ourselves.
if [ -x /nix/var/nix/profiles/default/bin/nix-daemon ]; then
  /nix/var/nix/profiles/default/bin/nix-daemon >/tmp/nix-daemon.log 2>&1 &
fi

# --- Persistent state ------------------------------------------------------
mkdir -p /config/.workshop

# Mounted host repos are owned by the host UID; tell git they're trusted so
# `git worktree add` and friends don't abort with "dubious ownership".
git config --system --add safe.directory '*' 2>/dev/null || true

# --- Privilege drop --------------------------------------------------------
if [ "$PUID" != "0" ]; then
  # Reconcile a 'workshop' group/user with the requested ids (idempotent).
  if getent group workshop >/dev/null 2>&1; then
    groupmod -o -g "$PGID" workshop
  else
    groupadd -o -g "$PGID" workshop
  fi
  if getent passwd workshop >/dev/null 2>&1; then
    usermod -o -u "$PUID" -g "$PGID" workshop
  else
    useradd -o -u "$PUID" -g "$PGID" -d /config -s /bin/bash workshop
  fi

  # Own the state dir (not a recursive chown of repos/nix — those stay as-is).
  chown "$PUID:$PGID" /config /config/.workshop 2>/dev/null || true

  # Agent/forge credentials live in $HOME dotfiles, and anything that ever ran
  # as root leaves them root-owned: Docker creates a missing bind-mount target
  # as root, an image rebuild or a PUID=0 start writes as root, and `docker
  # exec` bypasses the drop below. Claude Code writes these mode 0620/0700, so
  # root-owned means PUID cannot read them *at all* — it then treats
  # ~/.claude.json as absent and re-runs onboarding, losing the stored sign-in
  # and theme on every restart. Reconcile only mismatched entries so a clean
  # boot pays for a stat pass and nothing else.
  for p in /config/.claude.json /config/.claude /config/.codex /config/.gemini \
           /config/.cursor /config/.config /config/.git-credentials; do
    [ -e "$p" ] || continue
    find "$p" -xdev \( ! -user "$PUID" -o ! -group "$PGID" \) \
      -exec chown -h "$PUID:$PGID" {} + 2>/dev/null || true
  done

  exec gosu "$PUID:$PGID" "$@"
fi

# Running as root (default).
exec "$@"
