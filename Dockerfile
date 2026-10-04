# syntax=docker/dockerfile:1

###############################################################################
# Builder stage — install all deps (incl. native modules) and build frontend
###############################################################################
FROM node:24-slim AS builder

WORKDIR /app

# Build tools for native modules (better-sqlite3, node-pty)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies against the lockfile first (better layer caching).
# scripts/ is needed because the postinstall hook runs
# scripts/fix-node-pty-permissions.cjs.
COPY package.json package-lock.json ./
COPY scripts/ scripts/
RUN npm ci

# Copy the rest of the source and build the frontend bundle (dist/client).
# The server runs from source via tsx (matching the prod recipe in
# scripts/workshop.sh), so we deliberately only build the client here.
COPY . .
RUN npx vite build


###############################################################################
# Runtime stage — slim image with the toolchain agents need at run time
###############################################################################
FROM node:24-slim AS runtime

# --- Base OS tooling -------------------------------------------------------
# git/tmux: required by Workshop to create worktrees and host agent sessions.
# jq/sqlite3/ripgrep/less: common helpers used inside agent sessions.
# gosu: drop privileges to PUID/PGID at startup (unraid convention).
# curl/xz-utils: needed to install Nix. openssh-client: git-over-ssh.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git tmux bash ca-certificates curl xz-utils openssh-client procps \
      jq sqlite3 ripgrep less direnv gosu dumb-init \
  && rm -rf /var/lib/apt/lists/*

# --- GitHub CLI (gh) -------------------------------------------------------
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# --- Gitea/Forgejo CLI (tea) -----------------------------------------------
# Static binary, arch-matched to the image. Drives self-hosted Forgejo/Gitea
# (PRs, issues, releases) the way gh drives GitHub. No secret baked in — auth
# comes from the interactive auth terminal (`tea login add`) and persists to
# ~/.config/tea on the /config volume, same as gh/Claude.
ARG TEA_VERSION=0.14.1
RUN arch="$(dpkg --print-architecture)" \
  && curl -fsSL "https://dl.gitea.com/tea/${TEA_VERSION}/tea-${TEA_VERSION}-linux-${arch}" \
       -o /usr/local/bin/tea \
  && chmod +x /usr/local/bin/tea \
  && tea --version

# --- code-server ---------------------------------------------------------
# Standalone install (no systemd/root service) so Workshop can spawn/manage it
# itself and proxy it through its own port — see src/infrastructure/code-server.
ARG CODE_SERVER_VERSION=4.140.0
RUN curl -fsSL https://code-server.dev/install.sh | sh -s -- --method=standalone --prefix=/usr/local --version=${CODE_SERVER_VERSION} \
  && code-server --version

# --- Nix (multi-user) for per-project dependency management ----------------
# Tracked projects use flake.nix + direnv `use flake`. The Determinate
# installer is container-friendly (--init none = no systemd) and enables the
# nix-command + flakes experimental features by default. The nix-daemon is
# started by docker-entrypoint.sh so any user (incl. a dropped PUID) can build.
RUN curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix \
      | sh -s -- install linux --init none --no-confirm
ENV PATH="/nix/var/nix/profiles/default/bin:${PATH}"

# --- Claude Code CLI -------------------------------------------------------
# Installed in-image so `command -v claude` resolves to an arch-correct binary;
# authentication comes from the bind-mounted ~/.claude at runtime.
RUN npm install -g @anthropic-ai/claude-code

# --- Application -----------------------------------------------------------
WORKDIR /app
# Bring the fully-installed, built project (node_modules + dist/client + source)
COPY --from=builder /app /app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# HOME=/config so all $HOME-derived state (~/.workshop, ~/.claude) lands on the
# persistent /config volume.
# DISABLE_AUTOUPDATER: the global npm prefix is root-owned, so the runtime user's
# auto-update always fails. Claude Code updates by rebuilding the image instead.
ENV NODE_ENV=production \
    HOME=/config \
    DISABLE_AUTOUPDATER=1 \
    PORT=3002 \
    WORKSHOP_VAULT_ROOT=/config/.workshop/vault \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TERM=xterm-256color

EXPOSE 3002

ENTRYPOINT ["dumb-init", "--", "docker-entrypoint.sh"]
CMD ["npx", "tsx", "src/server/index.ts"]
