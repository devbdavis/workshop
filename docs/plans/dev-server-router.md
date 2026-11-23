# Dev Server Router

*   **Author:** Brendan Davis
*   **Status:** Draft
*   **Date:** 2026-11-23

--------------------------------------------------------------------------------

## Overview

A session gets a **Dev Server** button next to its VS Code, Files and Diff
buttons. The button opens `https://<track>-<sid>.beta.workshop.chu.zone`, a
hostname that belongs to that session. Workshop receives every request for that
hostname, starts the session's dev server if it is not running, and proxies the
request to it. The command that starts the dev server is stored on the track.

The dev server runs inside the Workshop container, on a port only Workshop can
reach. Nothing new is published from Docker. One wildcard DNS record and one
wildcard certificate cover every session.

## The Problem

Agents work in per-session git worktrees inside the Workshop container on
unraid. When the user wants to try what an agent built, someone has to start
the app's dev server and the user has to reach it from a browser. Today:

*   The container publishes only port 3002, so a dev server inside it is
    unreachable from the LAN or from work.
*   Publishing a port range (PR #57) makes servers reachable but forces the user
    to track which session got which port. Those ports also have no
    authentication in front of them.
*   Starting a server is a manual chat request to an agent, with no fixed
    command per project and no consistent place to find the URL.

The user runs several projects (Workshop itself, Nozzle Works, others) and
often wants several sessions' servers open at once.

## Goals

*   One click from a session opens that session's running app in a browser tab.
*   A request to a session hostname whose server is not running starts it, then
    shows the app once it answers. No separate start step.
*   Any number of sessions can serve at the same time without the user choosing
    or remembering ports.
*   The same URL works at home and from work, behind Workshop's existing login.
*   Each track stores its own start command: a single `npm run dev`, or a script
    that starts several processes.
*   A session's dev server stops when the session is deleted.

## Non-Goals

*   Running dev servers in separate containers or through Docker. Workshop gets
    no Docker socket.
*   Production-like preview builds from CI (Gitea Actions). That is a separate
    flow.
*   Exposing more than one port per session. A backend on a second port must be
    reached through the frontend's own dev proxy.
*   Idle timeouts or resource limits on dev servers.
*   Path-based routing (`/dev/<session>/...`).
*   Native (non-Docker) installs at `localhost`. The router needs a wildcard
    domain. Native installs keep starting servers by hand.

## Open Questions

*   **Edge and certificate**: what terminates TLS for `workshop.chu.zone`
    today? This decides how `*.beta.workshop.chu.zone` gets a certificate.
    *   *Cloudflare (proxy or tunnel)*: the free Universal SSL certificate
        covers only `*.chu.zone`, one level deep. `*.beta.workshop.chu.zone`
        needs Advanced Certificate Manager (paid), or the hostname scheme must
        flatten to `<track>-<sid>.chu.zone`. With that flatter scheme, other
        `*.chu.zone` services share the wildcard route, so the tunnel ingress
        rules must list the existing hostnames before the wildcard.
    *   *Nginx Proxy Manager, SWAG or Caddy on unraid*: a Let's Encrypt DNS-01
        challenge issues `*.beta.workshop.chu.zone`. The proxy forwards that
        wildcard host to Workshop's port 3002 unchanged. This fails only if the
        DNS provider has no API the proxy supports.
    *   *Tailscale only*: MagicDNS has no wildcard records. This needs a DNS
        server (Pi-hole, AdGuard) set as Tailscale split DNS, and a certificate
        from a DNS-01 challenge as above. Fails if no such DNS server exists.
*   **Auth scope**: how does the browser prove it is logged in on a session
    hostname? Exactly one of:
    *   *Shared cookie*: set `workshop_token` with
        `Domain=.workshop.chu.zone`. One login covers every dev host. Every dev
        app receives the Workshop token in its request cookies (the proxy can
        strip it before forwarding, but app JavaScript on that origin cannot
        read it because it is `httpOnly`). Fails if any dev app is untrusted,
        since a server-side bug or a dependency in that app could log the
        token.
    *   *Per-host handoff*: the button opens
        `https://<host>/__workshop/auth?t=<short-lived one-time code>`. Workshop
        swaps the code for a host-only cookie and redirects to `/`. The main
        token never leaves `workshop.chu.zone`. Costs a code store with expiry
        and a redirect route. Fails for bookmarked or shared dev URLs opened in
        a fresh browser: they show a "sign in through Workshop" page.
*   **Workshop's own dev mode on a session**: Workshop's `npm run dev` binds
    fixed ports 3001 and 5173, so two Workshop sessions cannot both serve, and
    neither honours `$PORT`. A Workshop track command would need
    `vite --port $PORT` with the backend on a derived port. To be settled when
    the Workshop track's command is written; not a blocker for the router.

## Critical User Journeys (CUJs)

### CUJ 1: Open a session's app for the first time

*   **Given**: The track's dev command is `npm run dev -- --port $PORT`. The
    session has a worktree. No dev server is running for it. The user is logged
    in to Workshop.
*   **When**: The user clicks **Dev Server** in the session's pane header.
*   **Then**: A new tab opens at `https://nozzle-3f9a1c2e.beta.workshop.chu.zone`.
    The tab shows a "Starting dev server…" page that reloads every two seconds.
    Within the start timeout the app loads. Vite hot reload works in that tab.
    The button shows a running indicator.

### CUJ 2: Three sessions at once

*   **Given**: Three sessions on two tracks, each with a dev command.
*   **When**: The user opens all three Dev Server links.
*   **Then**: Each tab shows its own session's code. Workshop picked three
    different free ports. The user never saw a port number.

### CUJ 3: From work

*   **Given**: The user is away from home and reaches `workshop.chu.zone`
    through the same edge as at home.
*   **When**: They open a Dev Server link.
*   **Then**: It behaves as at home. Without a valid Workshop login the
    response is 401 and no server is started.

### CUJ 4: The server fails to start

*   **Given**: The dev command exits with an error (missing dependencies).
*   **When**: The user opens the Dev Server link.
*   **Then**: The page shows the exit code and the last 50 lines of the
    command's output, and a **Retry** link. It does not loop forever.

### CUJ 5: Session deleted

*   **Given**: A session's dev server is running.
*   **When**: The user deletes or soft-deletes the session.
*   **Then**: The dev server process stops. The hostname returns 404.

## Technical Plan (Architecture)

```text
browser ── https://nozzle-3f9a1c2e.beta.workshop.chu.zone/...
   │
   ▼
edge (TLS for *.beta.workshop.chu.zone) ──► Workshop :3002, Host header unchanged
   │
   ▼
devServerRouter.middleware  (first middleware; also hooked into 'upgrade')
   ├─ Host does not end in .$WORKSHOP_DEV_DOMAIN  → next()  (normal Workshop)
   ├─ no valid Workshop auth                      → 401
   ├─ <sid> (8 hex chars) matches no live session → 404
   ├─ track has no dev command                    → 404 "no dev command set"
   ├─ devServers.ensure(session)
   │     ├─ running and port answers  → port
   │     ├─ starting                  → 503 "Starting…" page, auto-reload
   │     └─ exited                    → 502 page with exit code + log tail
   └─ proxy HTTP / WebSocket to 127.0.0.1:<port>, Host rewritten to 127.0.0.1:<port>
```

### Hostname

`<track-slug>-<sid>.<WORKSHOP_DEV_DOMAIN>`. `<sid>` is the first 8 hex
characters of the session UUID. The router parses only the last `-`-separated
part of the first label. The track slug is for humans and is ignored when
routing, so renaming a track does not break open tabs. The hostname has one
label under the base domain, so one wildcard certificate covers every session.
If the 8-character prefix matches more than one live session, the router
returns 409 and the button uses 12 characters for that session. With UUIDv4
and tens of sessions, a collision is unlikely.

`WORKSHOP_DEV_DOMAIN` (for example `beta.workshop.chu.zone`) is a new
environment variable. When it is unset, the router middleware does nothing and
the button is hidden.

### Process supervision

The dev server runs in a detached tmux session named `dev-<sid>`, with the
session's `workingDirectory` as its working directory and `PORT=<free port>`
in its environment. Its output is piped to
`~/.workshop/sessions/<sessionId>/dev-server.log`. The chosen port and the
command are written to `~/.workshop/sessions/<sessionId>/dev-server.json`. tmux
is chosen over a child process for three reasons: the terminal manager already
manages tmux sessions, the server survives a Workshop restart, and the user can
attach to it from a Shell session. After a restart, `ensure()` reads
`dev-server.json` and checks that the tmux session exists and the port answers,
then reuses the server.

`ensure()` keeps one in-flight start per session in memory, so concurrent
requests (a page load fetches many assets) do not start the command twice.

The command runs with no Host header rewriting by the app: the proxy sends
`Host: 127.0.0.1:<port>`, which passes Vite's allowed-hosts check without any
project configuration. Hot reload works because Vite's client connects to the
page's own host and port when `server.hmr.clientPort` is unset. Projects that
set it explicitly must remove it or set it to 443.

### Proxy

The HTTP and WebSocket forwarding in `src/server/code-server-proxy.ts` moves
into a shared helper that takes a target port and a path. The code-server proxy
and the dev-server router both call it. Behaviour of `/code` stays the same.

### Data model

`tracks.dev_command TEXT NULL`. `Track.devCommand?: string`. Edited in track
settings as a single-line text field with the hint
"Runs in the session's workspace with `$PORT` set. Example:
`cd nozzle && npm run dev -- --port $PORT`". Multi-repo workspaces put the
`cd` in the command.

## Alternatives Considered

### Alternative A: Publish a port range per container (PR #57)

*   **Pros**: Tiny change. Works without DNS or certificates.
*   **Cons**: The user tracks port numbers per session. No authentication on
    the ports. Remote access needs Tailscale to reach raw ports. Fixed upper
    limit on concurrent servers.
*   **Reason for Rejection**: Rejected by author: the user does not want to
    manage ports, and the ports are unauthenticated.

### Alternative B: Traefik plus per-repo `compose.dev.yml` containers

*   **Pros**: Each dev server is isolated in its own container. Traefik routes
    by Docker labels. Fits CI-built images from Gitea.
*   **Cons**: Workshop needs the Docker socket, which is root on the unraid
    host. Live-reload mode needs host paths for worktrees that live inside
    Workshop's own volume. Every repo needs a compose file and labels.
*   **Reason for Rejection**: Rejected by author: the user wants the server to
    run from the session's local workspace through a Workshop button, not
    through Docker.

### Alternative C: Path-based routing under Workshop's host (`/dev/<sid>/`)

*   **Pros**: No wildcard DNS or certificate. Reuses the existing cookie as is.
*   **Cons**: Apps assume they are served at `/`. Vite needs `base` set per
    project, absolute links and API calls break, and hot reload paths need
    rewriting.
*   **Reason for Rejection**: Rejected by author: it breaks most dev servers
    unless each project is changed.

### Alternative D: Two-level hostnames (`<session>.<track>.beta.workshop.chu.zone`)

*   **Pros**: Reads naturally.
*   **Cons**: A wildcard certificate covers one label only, so each track needs
    its own certificate and DNS entry.
*   **Reason for Rejection**: Rejected by author: one-label hostnames need one
    certificate for everything.

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Security**: The router checks Workshop auth before it resolves a session
    or starts anything. An unauthenticated request never runs a command. The
    dev command is user-entered track data and runs as the Workshop user, the
    same trust level as an agent's shell. The `Host` header is client-supplied.
    A forged host only selects which session's server to reach, and auth is
    still required. The proxy removes the `workshop_token` cookie and any
    `?token=` parameter before forwarding, so dev apps do not log it.
*   **Resources**: Each running dev server holds memory until its session is
    deleted. There is no idle timeout (see Future Improvements).
*   **Rollout**: Off unless `WORKSHOP_DEV_DOMAIN` is set. Rollback is unsetting
    it. The `dev_command` column is additive.

--------------------------------------------------------------------------------

### Additional Resources

*   `src/server/code-server-proxy.ts`: existing auth-gated HTTP and WebSocket
    reverse proxy that this design generalises.
*   `src/infrastructure/code-server/code-server.ts`: existing free-port and
    wait-for-port helpers.
*   [docs/docker.md](../docker.md): container layout and volumes.
*   PR #57: the port-range approach this design replaces.

### Future Improvements

*   **Idle stop**: stop a dev server after N minutes with no proxied requests.
*   **Per-session override**: a session-level command that overrides the
    track's.
*   **Status in the session list**: show which sessions are serving.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

### Target Files to Create/Modify

#### 1. `src/server/reverse-proxy.ts` (Create)

*   **Type / Scope**: TypeScript module, server.
*   **Proposed Changes**: The HTTP forwarding and WebSocket upgrade forwarding
    from `code-server-proxy.ts`, as two functions:
    `proxyHttp(req, res, port, path, headerOverrides)` and
    `proxyUpgrade(req, socket, head, port, path)`. Both set
    `Host: 127.0.0.1:<port>` and `x-forwarded-proto` / `x-forwarded-host`.
    `proxyHttp` removes `workshop_token` from the forwarded `Cookie` header.
    No routing or auth.

#### 2. `src/server/code-server-proxy.ts` (Modify)

*   **Type / Scope**: TypeScript module, server.
*   **Proposed Changes**: Replace the inline forwarding with calls to
    `reverse-proxy.ts`. Prefix, auth and availability checks stay. No
    behaviour change.

#### 3. `src/infrastructure/net/ports.ts` (Create) and `src/infrastructure/code-server/code-server.ts` (Modify)

*   **Type / Scope**: TypeScript modules, infrastructure.
*   **Proposed Changes**: Move the existing private `findFreePort()` and
    `waitForPort()` out of `code-server.ts` into `ports.ts` and export them.
    `code-server.ts` imports them from there. The dev-server manager uses them
    without depending on the code-server module.

#### 4. `src/infrastructure/dev-server/dev-server-manager.ts` (Create)

*   **Type / Scope**: TypeScript module, infrastructure.
*   **Proposed Changes**:
    *   `ensure(session, command): Promise<{ state: 'running', port } | { state: 'starting' } | { state: 'exited', code, logTail }>`.
        Reads `dev-server.json` and checks the tmux session `dev-<sid>` and the
        port. If none is running, picks a free port, writes `dev-server.json`,
        and runs
        `tmux new-session -d -s dev-<sid> -c <workingDirectory> -e PORT=<port> "<command> 2>&1 | tee <log>; echo __EXIT:$? >> <log>"`.
        Holds one in-flight start per session. Returns `starting` until the
        port answers, and `exited` once the log has an `__EXIT:` line.
        Start timeout: 120 seconds, after which it reports `exited` with the
        log tail.
    *   `status(sessionId)`: same states, without starting anything.
    *   `stop(sessionId)`: `tmux kill-session -t =dev-<sid>`, deletes
        `dev-server.json`.
    *   The command string goes to tmux as a single argument. No shell
        interpolation by Workshop.

#### 5. `tests/infrastructure/dev-server-manager.test.ts` (Create)

*   **Type / Scope**: Vitest.
*   **Proposed Changes**: Uses a real tmux and
    `python3 -m http.server $PORT --bind 127.0.0.1` as the command. Cases:
    starts and returns `running`; a second `ensure` returns the same port;
    concurrent `ensure` calls start once; a command that exits 1 returns
    `exited` with its output; `stop` kills it. Skipped when tmux is absent.

#### 6. `src/server/dev-server-router.ts` (Create)

*   **Type / Scope**: TypeScript module, server.
*   **Proposed Changes**: `createDevServerRouter({ sessions, tracks, devServers, domain })`
    returns `{ middleware, handleUpgrade }`, like the code-server proxy.
    `parseDevHost(host, domain): string | null` returns the `<sid>` prefix.
    The middleware runs the flow in the Technical Plan diagram. The
    "Starting…" and failure pages are small inline HTML strings with
    `<meta http-equiv="refresh" content="2">` on the starting page. The
    failure page HTML-escapes the log tail. If the per-host handoff option is
    chosen, this file also serves `/__workshop/auth`.

#### 7. `tests/server/dev-server-router.test.ts` (Create)

*   **Type / Scope**: Vitest.
*   **Proposed Changes**: `parseDevHost`: valid host, host with port, wrong
    domain, non-hex `sid`, uppercase. Middleware with a stub manager: non-dev
    host calls `next`; no auth returns 401 and does not call `ensure`; unknown
    `sid` returns 404; `starting` returns 503 with the refresh page; `running`
    forwards.

#### 8. `src/server/index.ts` (Modify)

*   **Type / Scope**: Server wiring.
*   **Proposed Changes**: When `WORKSHOP_DEV_DOMAIN` is set, create the router
    and mount its middleware first, before the code-server proxy and
    `express.json()`, so request bodies reach the dev server unconsumed. Pass
    it to `setupWebSocket`.

#### 9. `src/server/websocket.ts` (Modify)

*   **Type / Scope**: Server wiring.
*   **Proposed Changes**: In the `upgrade` handler, call
    `devServerRouter.handleUpgrade` before `codeServerProxy.handleUpgrade`.
    Without this, Vite hot reload WebSockets on dev hosts fall through to the
    terminal socket handler.

#### 10. `src/server/auth-routes.ts` (Modify, shared-cookie option only)

*   **Type / Scope**: Server.
*   **Proposed Changes**: When `WORKSHOP_DEV_DOMAIN` is set, set and clear the
    `workshop_token` cookie with `domain` equal to the parent of the dev domain
    that also covers Workshop's own host (`.workshop.chu.zone`), derived from
    `WORKSHOP_DEV_DOMAIN` minus its first label. `SameSite=Strict` still
    works: subdomains of one registrable domain are the same site.

#### 11. `src/foundation/types.ts` (Modify)

*   **Type / Scope**: Shared types.
*   **Proposed Changes**: `Track.devCommand?: string`. A `DevServerStatus`
    type for the status API: `'stopped' | 'starting' | 'running' | 'exited'`.

#### 12. `src/infrastructure/persistence/database.ts` (Modify)

*   **Type / Scope**: SQLite migration.
*   **Proposed Changes**: Guarded `ALTER TABLE tracks ADD COLUMN dev_command TEXT;`,
    following the existing `worktree_mode` migration pattern.

#### 13. `src/infrastructure/persistence/track-repository.ts` (Modify)

*   **Type / Scope**: Repository.
*   **Proposed Changes**: Read and write `dev_command` in the insert, update
    and row-mapping code.

#### 14. `src/server/api.ts` (Modify)

*   **Type / Scope**: REST API.
*   **Proposed Changes**: `PUT /tracks/:id` accepts `devCommand`.
    `GET /sessions/:id/dev-server` returns `{ url, status }`, where `url` is
    `null` when the feature is off or the track has no command.
    `DELETE /sessions/:id/dev-server` stops it. `api.ts` is over the
    300-line file limit already, so these two routes go in a new
    `src/server/dev-server-routes.ts` mounted from `api.ts`.

#### 15. `src/server/dev-server-routes.ts` (Create)

*   **Type / Scope**: REST API.
*   **Proposed Changes**: The two session routes above. Builds the URL from
    the track name slug, the `sid` and `WORKSHOP_DEV_DOMAIN`.

#### 16. `src/infrastructure/terminal/manager.ts` (Modify)

*   **Type / Scope**: Session lifecycle.
*   **Proposed Changes**: `destroySession` and `softDeleteSession` call
    `devServers.stop(sessionId)` before removing the worktree, so a server
    never runs on a deleted directory.

#### 17. `src/ui/workspace/WorkspaceButtons.tsx` (Modify)

*   **Type / Scope**: React UI.
*   **Proposed Changes**: A **Dev Server** button, shown only when
    `GET /sessions/:id/dev-server` returns a `url`. Clicking opens the URL in a
    new tab (`target="_blank" rel="noopener"`). A small dot shows `running`
    (green), `starting` (amber), `exited` (red), polled every 10 seconds while
    the pane is visible. A secondary **Stop** action calls the DELETE route.
    Accessible name: "Open dev server".

#### 18. `src/ui/track-view/TrackConfig.tsx` (Modify)

*   **Type / Scope**: React UI.
*   **Proposed Changes**: A "Dev server command" text input that saves
    `devCommand`, with the `$PORT` hint from the Technical Plan.

#### 19. `docker-compose.yml`, `docs/unraid/workshop.xml` (Modify)

*   **Type / Scope**: Deployment config.
*   **Proposed Changes**: Optional `WORKSHOP_DEV_DOMAIN` variable, empty by
    default.

#### 20. `docs/docker.md` (Modify)

*   **Type / Scope**: Documentation.
*   **Proposed Changes**: A "Dev servers" section: set
    `WORKSHOP_DEV_DOMAIN`, point a wildcard DNS record and certificate at
    Workshop for the chosen edge, write a track's dev command with `$PORT`,
    and the `hmr.clientPort` note.

#### 21. `docs/features.md` (Modify)

*   **Type / Scope**: Documentation.
*   **Proposed Changes**: One entry describing the Dev Server button.

### Verification Plan

*   **Compilation/Build**: `npm run typecheck`, `npm run build`.
*   **Unit Tests**: `npm test`, including the new router and manager tests and
    the existing `tests/server/code-server-proxy.test.ts` unchanged.
*   **Static Analysis & Linting**: none configured (`npm run lint` is a stub); `npm run typecheck` covers it.
*   **E2E/Integration**: Manual, on unraid with the wildcard DNS and
    certificate in place: CUJ 1 with a Vite project (confirm hot reload by
    editing a file), CUJ 2 with three sessions, CUJ 3 from a phone off Wi-Fi,
    CUJ 4 with a deliberately broken command, and CUJ 5 by deleting a session
    and checking `tmux ls`.

--------------------------------------------------------------------------------

<!-- Provenance: Indicates initial structural drafting via EGM. -->

*Drafted with EGM*
