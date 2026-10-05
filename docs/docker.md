# Running Workshop in Docker (incl. unraid)

Workshop can run in a container, including on an unraid server. Because Workshop
spawns the `claude` CLI inside `tmux` and creates `git` worktrees, the image
ships with a full toolchain (`git`, `tmux`, the `claude` CLI, `gh`, `nix`,
`direnv`, `jq`, `sqlite3`, `ripgrep`) and all mutable state lives on volumes.

## What the image contains

- **Node 24** + the Workshop server (run from source via `tsx`, frontend
  pre-built to `dist/client`).
- **Claude Code CLI** (`@anthropic-ai/claude-code`) — authentication is supplied
  by the host's `~/.claude`, bind-mounted in.
- **Nix** (multi-user, flakes enabled) + **direnv** so per-project `flake.nix` /
  `use flake` dependency management works inside agent sessions. The `nix-daemon`
  is started automatically by the entrypoint.
- **gh**, **jq**, **sqlite3**, **ripgrep**, **git**, **tmux**, **openssh-client**.

## Volumes

| Container path     | Purpose                                                            |
|--------------------|-------------------------------------------------------------------|
| `/config`          | `HOME`. Holds `~/.workshop` (SQLite db, auth-token, sessions, vault, sprites) **and `~/.claude.json`**, which is where Claude Code keeps your sign-in session. Persist this. |
| `/config/.claude`  | Claude Code auth/config — bind-mount your **logged-in** host `~/.claude`. Holds `.credentials.json` (tokens) and `settings.json` (theme). |
| `/repos`           | Host directory of git repos Workshop manages. Reference them in the UI as `/repos/<name>`. |

## Prerequisites

1. The mounted `~/.claude` must already be logged in — verify on the host with
   `claude --version` and that a session works. The container reuses those
   credentials; it cannot log in interactively for you.
2. The git repos you want to manage must be reachable inside the container under
   `/repos`. Put or clone them under the host directory you map to `/repos`.

## Run with docker compose

From the repo root:

```bash
# optional overrides via a .env file next to docker-compose.yml
#   REPOS_DIR=/mnt/user/code
#   CLAUDE_CONFIG_DIR=/mnt/user/appdata/workshop/claude
#   PUID=99
#   PGID=100

docker compose up -d --build
# open http://localhost:3002
```

`PUID`/`PGID` default to `99`/`100` (unraid's `nobody:users`). Set them to `0`/`0`
to run as root.

## Run on unraid

1. Build and tag the image as `workshop:latest` (on the unraid host or build
   elsewhere and `docker save` / `docker load`):

   ```bash
   docker build -t workshop:latest https://github.com/devbdavis/workshop.git#docker-builds
   ```

2. Install the Community Applications template: copy
   [`docs/unraid/workshop.xml`](./unraid/workshop.xml) to
   `/boot/config/plugins/dockerMan/templates-user/` (or use Docker tab → Add
   Container and fill in the paths), then set:
   - **State** → e.g. `/mnt/user/appdata/workshop`
   - **Claude config** → a logged-in `~/.claude` copy, e.g. `/mnt/user/appdata/workshop/claude`
   - **Repos** → your code share, e.g. `/mnt/user/code`
   - **WebUI Port** → `3002`

3. Start the container and open `http://<unraid-ip>:3002`.

## Getting a terminal inside the container

Start a session with the **Shell** CLI option (New Session → CLI tool → Shell). It
opens a tmux pane at the session's working directory with no AI CLI attached —
`nix`, `direnv`, `git`, and `gh` are all on `$PATH`, and it streams to the browser
over the same WebSocket every other session uses.

No `sshd`, no `docker exec`, no Docker socket mount. The "Open in Terminal" button
in the pane header is a *host*-side launcher (iTerm/Konsole/Windows Terminal) and
is only useful for native, non-Docker installs.

## Per-user editor paths

"Open in Editor" hands `<uri prefix><path>` to your local editor. If you SSH into
the **container**, the container paths are already correct and no remapping is
needed. If you SSH into the **host**, set path remaps in Settings → Profile — one
`<container> -> <editor>` rule per line, longest matching prefix wins:

```
/repos -> /mnt/user/repos
/config -> /mnt/user/appdata/workshop
```

`/repos` and `/config` come from different host locations (bind mount vs. named
volume), so they need separate rules. A catch-all `/ -> /mnt/host` line can sit
alongside more specific rules.

## Design Mode (optional)

Design Mode lets you pick an element in a live preview of your dev server.
Workshop proxies your dev server on a second port, the **preview port**
(`WORKSHOP_PREVIEW_PORT`, default `3102`). This port must be mapped to the
*same number* on the host, since the UI builds the preview URL as
`<same-hostname>:<port>`.

Element screenshots are optional and come from a separate sidecar container
(`docker/playwright`) running headless Chromium, since the full browser
toolchain doesn't belong in the main image. Without it, picks are still sent
to Claude, just without a screenshot.

- **docker compose**: add to `.env`:

  ```
  COMPOSE_PROFILES=design-mode
  WORKSHOP_SCREENSHOT_URL=http://playwright:3100
  ```

  then `docker compose up -d --build`. This builds and starts the
  `playwright` sidecar alongside `workshop` and wires them together over the
  compose network.

- **unraid**: two separate containers, each pointed at the other's unraid IP
  (containers on `bridge` networking can't resolve each other by name).
  Install [`docs/unraid/workshop-playwright.xml`](./unraid/workshop-playwright.xml)
  for the sidecar, set its **WORKSHOP_PREVIEW_URL** to
  `http://<unraid-ip>:3102`, then set **WORKSHOP_SCREENSHOT_URL** on the
  `workshop` template to `http://<unraid-ip>:3100`.

- **running locally without Docker**:

  ```bash
  cd docker/playwright && npm install && npx playwright install chromium
  WORKSHOP_PREVIEW_URL=http://localhost:3101 node server.mjs
  # then start Workshop with WORKSHOP_SCREENSHOT_URL=http://localhost:3100
  ```

If your preview is behind an HTTPS reverse proxy, the preview port needs to
be proxied too, not just the main Workshop port.

## Notes & caveats

- **Auth token**: a Workshop API auth-token is generated on first request under
  `/config/.workshop/auth-token` and persists on the state volume.
- **Repo ownership**: the entrypoint sets `git safe.directory = *` so host-owned
  repos don't trip git's "dubious ownership" guard.
- **Claude config ownership**: the entrypoint reconciles ownership of the agent
  and forge credential paths (`~/.claude.json`, `~/.claude`, `~/.codex`,
  `~/.gemini`, `~/.cursor`, `~/.config`, `~/.git-credentials`) to `PUID:PGID` on
  every start, touching only entries that don't already match. Without this,
  "I have to log in again on every restart" is the usual symptom: Docker creates
  a missing bind-mount target as root, and an image rebuild or a `PUID=0` start
  writes as root too. Claude Code stores `~/.claude.json` mode `0620` and parts
  of `~/.claude` mode `0700`, so root-owned means the runtime user cannot read
  them at all — Claude Code treats the sign-in session as absent and re-runs
  onboarding, which is why both the login *and* the theme come back blank. The
  reconcile heals an already-broken mount; no manual `chown` needed.
- **Nix store**: `/nix` lives inside the image layer. Build caches are rebuilt if
  you recreate the image; mount a volume at `/nix` if you want them to persist
  across rebuilds (optional, not default — the store can grow large).
- **Architecture**: native modules (`better-sqlite3`, `node-pty`) are compiled
  during the image build, so build on the same architecture you run on
  (unraid is typically `amd64`).
