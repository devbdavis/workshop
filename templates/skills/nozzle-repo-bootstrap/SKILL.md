---
name: nozzle-repo-bootstrap
description: "Scaffolds an existing, freshly-created Nozzle Industries repo (already made on git.chu.zone and connected to Workshop) with its standard dev + CI setup: direnv + a Nix flake (latest-stable Go, current Node Active LTS), a multi-stage Dockerfile, and Forgejo Actions that check every PR, push a per-PR beta image, and on merge to main cut a release and publish Docker images to docker.chu.zone - then opens a draft PR. Use whenever someone is setting up / scaffolding a new Nozzle Industries repo, adding its Nix dev shell + direnv, or wiring its Forgejo Actions CI and docker.chu.zone publishing - even if they only mention one of those pieces. This does NOT create the repo (assume it already exists); it fills an empty repo with the house scaffold. Tagged: workshop."
templateName: nozzle-repo-bootstrap
---

# Nozzle Industries Repo Scaffold

Fills an already-created Nozzle Industries repo with the standard dev + CI
setup, so every service looks the same and the toolchain never drifts. Assume
the repo already exists on `https://git.chu.zone/nozzle-industries/<repo>` and is
already connected to Workshop - you are running inside its session worktree.
This skill scaffolds and opens a draft PR; it does not create the repo.

The house reference repos are `obs-irl-backstage` and `nozzle-works` (read them
under `/repos` if present - they are the ground truth this was distilled from).

What you add:

- **direnv + Nix flake** pinning the toolchain, shared by local dev and CI.
- A multi-stage **Dockerfile**.
- **Forgejo Actions** CI: PR checks + per-PR beta image; merge-to-main cuts a
  release and publishes Docker images to **docker.chu.zone**.
- A **draft PR** with the scaffold.

Everything you write is ASCII on purpose - see Conventions. Keep it that way.

Derive the repo name and org from the remote instead of asking:
`git remote get-url origin` -> `.../nozzle-industries/<repo>.git`.

## Prerequisites (confirm, do not assume)

These live outside the repo. If any is missing, say so plainly rather than
working around it - the CI cannot be verified without them.

1. **A `self-hosted` Forgejo Actions runner** with Docker and a persistent
   `/nix` store. CI targets `runs-on: self-hosted` specifically because the
   persistent nix store keeps the pinned toolchain warm between runs; a
   throwaway `ubuntu-latest` container reinstalls Nix every run.
2. **`docker.chu.zone` reachable and anonymous** (open pull AND push). Verify:
   `curl -s -o /dev/null -w '%{http_code}' -X POST https://docker.chu.zone/v2/nozzle-industries/<repo>/blobs/uploads/`
   should return `202`. If it needs auth, add a `docker login` step backed by
   Forgejo Actions secrets - do not hardcode credentials.
3. **zot retention rules on the registry** (instance-level `config.json`). This
   skill names image tags to match them, so expiry is the registry's job, not a
   CI cleanup script. Expected policy:
   ```json
   "keepTags": [
     { "patterns": ["pr-.*"], "pushedWithin": "168h" },
     { "patterns": ["main", "latest", "release-.*"], "mostRecentlyPushedCount": 5 }
   ]
   ```
   `pr-<n>` -> pruned 7 days after last push; `latest` + `release-<version>` ->
   keep the 5 most recent. If the rules differ, adjust tag names to match them.
4. **`tea` logged in** to `git.chu.zone` (`tea login list` shows it) - needed to
   open the PR. Note tea cannot run from a worktree whose `.git` is a file, which
   is exactly the Workshop session case - see Conventions.

## Step 1 - Pick toolchain versions (latest stable, current LTS)

The rule is "latest stable so we are not already behind," with a twist:

- **Go has no LTS.** The Go team supports the latest two majors. Use the
  **latest stable Go**. In the flake that is simply `pkgs.go`; set the `go.mod`
  directive to match its major (`go 1.NN`).
- **Node has LTS.** Use the **current Active LTS** (an even major). Pin it
  explicitly as `pkgs.nodejs_NN` so you never float onto a non-LTS line.

Check what a pinned nixpkgs actually provides before committing:

```bash
export NIX_CONFIG="experimental-features = nix-command flakes"
nix eval --raw nixpkgs/nixos-unstable#go.version          # latest stable Go
nix eval --raw nixpkgs/nixos-unstable#nodejs_24.version   # bump 24 -> current LTS major
```

If unsure which Node major is the current Active LTS, check
`https://nodejs.org/en/about/previous-releases` (even major, status "Active
LTS"). Sibling repos are a good tiebreaker - match what they use.

## Step 2 - Scaffold the files

Create these at the repo root. Substitute `<repo>` (from the remote) and the
version majors you chose. Trim whichever language the repo does not use.

### flake.nix

```nix
{
  description = "<repo> - pinned Go + Node toolchain for dev and CI";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      # One toolchain for `nix develop` (local) and the CI check jobs, so
      # versions never drift. go = latest stable (no Go LTS); nodejs_NN =
      # current Node Active LTS. Trim whichever language the repo does not use.
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.go pkgs.nodejs_24 ];
        };
      });
    };
}
```

Generate the lock and validate the shell actually provides the toolchain
(Nix needs the file git-tracked first):

```bash
git add flake.nix
nix flake lock
nix develop -c bash -c 'go version; node --version'
```

### .envrc

```
# Auto-activate the Nix dev shell (flake.nix) on `cd` into this directory.
# First time: run `direnv allow`. Requires direnv + nix-direnv.
use flake
```

### .gitignore (add these; keep any language defaults too)

```
# direnv (nix-direnv cache; .envrc itself is tracked)
.direnv/

# build output / data
/data
dist/
node_modules/
```

### Dockerfile (Go backend + embedded web frontend)

Multi-stage: build web assets, build a static Go binary (pure Go, no CGO), ship
on distroless. For a Go-only repo drop the `web` stage and the `COPY --from=web`;
for a Node-only repo replace stages 2-3 with a node runtime image.

```dockerfile
# syntax=docker/dockerfile:1

# Stage 1: build the web frontend -> web/dist
FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci || npm install
COPY web/ ./
RUN npm run build

# Stage 2: build the static Go binary (pure Go, no CGO)
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
COPY --from=web /web/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /app ./cmd/<repo>

# Stage 3: minimal runtime
FROM gcr.io/distroless/static:nonroot
COPY --from=build /app /app
VOLUME /data
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app"]
```

Keep the Dockerfile Go/Node bases in lockstep with the flake majors.

If the Go binary uses `//go:embed` of `web/dist`, a bare `go build ./...`
(and CI) fails when `dist` is gitignored and absent. Commit a tiny placeholder
so a frontend-less build still compiles, and force-add ONLY that file:
`git add -f web/dist/index.html`. Docker/CI `npm run build` overwrites the tree.

### .forgejo/workflows/pr.yml

```yaml
name: PR checks

# Every PR to main: prove it builds (toolchain from the flake via `nix develop`,
# so CI and local dev share one pinned set of versions), then push a per-PR beta
# image (pr-<number>) so the change can be smoke-tested in a live environment.
#
# runs-on: self-hosted - the host runner's /nix store persists between runs, so
# the toolchain is downloaded once, not every run.
on:
  pull_request:
    branches: [main]

# A new push to the same PR cancels the previous, still-running check.
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  IMAGE: docker.chu.zone/nozzle-industries/<repo>

jobs:
  go:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - uses: DeterminateSystems/nix-installer-action@v3
      - run: nix develop -c go vet ./...
      - run: nix develop -c go test ./...
      - run: nix develop -c go build ./...

  web:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - uses: DeterminateSystems/nix-installer-action@v3
      - run: nix develop -c npm --prefix web ci
      - run: nix develop -c npm --prefix web run lint
      - run: nix develop -c npm --prefix web run build

  # pr-<number> is a moving tag: each push to the PR overwrites it. zot's
  # `pr-.*` retention rule prunes it 7 days after the last push - no cleanup job.
  beta-image:
    needs: [go, web]
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t "$IMAGE:pr-${{ github.event.pull_request.number }}" .
      - run: docker push "$IMAGE:pr-${{ github.event.pull_request.number }}"
```

### .forgejo/workflows/main.yml

```yaml
name: Publish

# Merge to main: the same checks, then cut a release (Gitea release + tag) and
# publish Docker images to docker.chu.zone.
#   - latest              (moving)  -> zot `latest` keep-5 bucket
#   - release-<version>   (immutable) -> zot `release-.*` keep-5 bucket
# No concurrency-cancel here: a publish should finish, not be killed by the next
# merge. docker.chu.zone is anonymous - no login, no secrets.
on:
  push:
    branches: [main]

env:
  IMAGE: docker.chu.zone/nozzle-industries/<repo>

jobs:
  checks:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      - uses: DeterminateSystems/nix-installer-action@v3
      - run: nix develop -c go vet ./...
      - run: nix develop -c go test ./...
      - run: nix develop -c go build ./...
      - run: nix develop -c npm --prefix web ci
      - run: nix develop -c npm --prefix web run lint
      - run: nix develop -c npm --prefix web run build

  release:
    needs: checks
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
      # CalVer + short SHA. This is the knob to change if you want semver or
      # tag-driven releases instead of one-per-merge.
      - name: Compute version
        run: echo "VERSION=v$(date -u +%Y.%m.%d)-${GITHUB_SHA:0:7}" >> "$GITHUB_ENV"
      - name: Build and push images
        run: |
          docker build -t "$IMAGE:latest" -t "$IMAGE:release-$VERSION" .
          docker push "$IMAGE:latest"
          docker push "$IMAGE:release-$VERSION"
      # Creates the git tag + a Gitea release. The runner token needs
      # contents:write (the default). Uses the gitea API - no extra secrets.
      - name: Cut Gitea release
        run: |
          curl -fsS -X POST \
            -H "Authorization: token ${{ secrets.GITHUB_TOKEN }}" \
            -H "Content-Type: application/json" \
            "${{ github.server_url }}/api/v1/repos/${{ github.repository }}/releases" \
            -d "{\"tag_name\":\"$VERSION\",\"target_commitish\":\"${{ github.sha }}\",\"name\":\"$VERSION\"}"
```

For a single-language repo, delete the unused job (`web` in pr.yml) and the
unused check lines in main.yml.

## Step 3 - Validate locally before pushing

Prove the scaffold builds in the same shell CI will use, so a red pipeline never
comes as a surprise:

```bash
nix develop -c bash -c 'go vet ./... && go test ./... && go build ./...'
nix develop -c bash -c 'npm --prefix web ci && npm --prefix web run build'
```

If you rebuilt `web/dist` locally, restore the committed placeholder so real
build output does not get committed: `git checkout -- web/dist/index.html`.

## Step 4 - Commit and open a draft PR

Stage files explicitly (never `git add -A` - it can sweep in build output).
Branch `feat/<slug>`, push, and open a **draft** PR. tea has no `--draft` flag;
a `WIP:` title prefix marks it draft.

```bash
git switch -c feat/scaffold
git add flake.nix flake.lock .envrc .gitignore Dockerfile .forgejo/workflows/pr.yml .forgejo/workflows/main.yml
git commit -m "Scaffold <repo>: flake + direnv + Forgejo CI"
git push -u origin feat/scaffold
```

You are in a Workshop session worktree, so `tea` fails here ("local repository
required"). Run it from the primary checkout - the clone with a real `.git`
directory (find it with `git worktree list`; it is the non-worktree path). Chain
the `cd` in one command because the sandbox reverts a bare `cd`:

```bash
cd /path/to/primary-checkout && tea pulls create --head feat/scaffold --base main \
  --title "WIP: Scaffold <repo>" --description "..."
```

(If a `submit-for-review` skill is available, you may hand the PR step to it
instead; it already encodes the branch + draft-PR flow.)

## Step 5 - Verify it actually works

Green checks are the definitive proof the runner + registry are wired right:

- Poll the run: `GET https://git.chu.zone/api/v1/repos/nozzle-industries/<repo>/actions/tasks`
  (needs an auth token header) until the jobs finish; confirm `go`, `web`, and
  `beta-image` all report success.
- Confirm the beta image is pullable:
  `curl -s https://docker.chu.zone/v2/nozzle-industries/<repo>/tags/list`
  should list `pr-<number>`.

## Conventions and gotchas (learned the hard way)

- **ASCII only, everywhere.** Forgejo flags ambiguous unicode (em dashes,
  arrows, box-drawing). Use `-`, `->`, `x`, `>=`, `...`, `+-|`. Applies to every
  file you write in the target repo.
- **tea from a worktree fails.** A Workshop session workspace is a git worktree
  whose `.git` is a *file* (gitdir pointer); tea reports "local repository
  required". Run `tea pulls create` from the primary checkout (real `.git` dir).
  The Bash sandbox also reverts a bare `cd` between calls - chain it:
  `cd /path/to/primary && tea ...`.
- **Registry is anonymous** - no `docker login`, no secrets. If that ever
  changes, add the login step backed by Forgejo Actions secrets; never hardcode.
- **Tag to match zot retention**, do not script deletion. `pr-<n>` (7-day),
  `latest` + `release-<version>` (keep-5). A bare short-SHA tag matches no rule
  and gets GC'd - always prefix (`release-`, `main-`).
- **`upload-artifact` must stay `@v3`** on Forgejo. `@v4` uses the
  `@actions/artifact` v2 backend which hard-refuses on GHES, and Forgejo reports
  as GHES (`GHESNotSupportedError`). Set `retention-days` on artifacts you do
  upload.
- **Third-party actions resolve fine** on the self-hosted runner
  (`DeterminateSystems/*`, `actions/*`). Use the nix-installer *action*
  (idempotent) rather than a raw `curl | sh` install: the raw installer refuses
  to run when Nix already exists, which it does on a persistent runner.
- **Forgejo API exposes no Actions run/job logs** on the current instance
  (`/actions/runs/...` and `.../logs` 404; the web log route needs a session
  cookie). Debug CI by reasoning from step timing and re-running, not by pulling
  logs via the API.

## Adapting for existing house repos

`obs-irl-backstage` uses `shell.nix` + `nix-shell` (conventional Nix, no flake);
this skill prefers a flake + `nix develop` because `flake.lock` pins nixpkgs
exactly. Either is fine - match the repo you are extending rather than mixing.
