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
| `/config`          | `HOME`. Holds `~/.workshop` (SQLite db, auth-token, sessions, vault, sprites). Persist this. |
| `/config/.claude`  | Claude Code auth/config — bind-mount your **logged-in** host `~/.claude`. |
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
   docker build -t workshop:latest https://github.com/bdavis-klaviyo/workshop.git#docker-builds
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

## Notes & caveats

- **Auth token**: a Workshop API auth-token is generated on first request under
  `/config/.workshop/auth-token` and persists on the state volume.
- **Repo ownership**: the entrypoint sets `git safe.directory = *` so host-owned
  repos don't trip git's "dubious ownership" guard.
- **Nix store**: `/nix` lives inside the image layer. Build caches are rebuilt if
  you recreate the image; mount a volume at `/nix` if you want them to persist
  across rebuilds (optional, not default — the store can grow large).
- **Architecture**: native modules (`better-sqlite3`, `node-pty`) are compiled
  during the image build, so build on the same architecture you run on
  (unraid is typically `amd64`).
