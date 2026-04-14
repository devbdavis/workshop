#!/usr/bin/env bash
# Capture the current shell's exported credentials into ~/.workshop/session.env
# so Workshop sessions launched after this point will inherit them.
#
# Usage (after running s2a-login or equivalent in this shell):
#   scripts/workshop-auth.sh [PREFIX...]
#
# Default: captures all AWS_* vars. Pass additional prefixes as arguments.
#   scripts/workshop-auth.sh AWS_ CUSTOM_AUTH_
#
# To clear saved credentials:
#   rm ~/.workshop/session.env

PREFIXES=("${@:-AWS_}")
ENV_FILE="$HOME/.workshop/session.env"

mkdir -p "$(dirname "$ENV_FILE")"

tmp=$(mktemp)
echo "# Workshop session credentials — $(date)" > "$tmp"

for prefix in "${PREFIXES[@]}"; do
  env | grep "^${prefix}" >> "$tmp" || true
done

count=$(grep -c "=" "$tmp" 2>/dev/null || true)

if [ "$count" -eq 0 ]; then
  echo "No vars found matching: ${PREFIXES[*]}"
  echo "Have you run s2a-login (or equivalent) in this shell first?"
  rm "$tmp"
  exit 1
fi

mv "$tmp" "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "Saved $count credential vars to $ENV_FILE"
echo "New Workshop sessions will inherit these credentials."
