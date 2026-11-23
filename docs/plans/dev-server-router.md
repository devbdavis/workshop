# Dev Server Router

*   **Author:** Brendan Davis
*   **Status:** Implemented
*   **Date:** 2026-11-23
*   **Review:** [dev-server-router-review.md](./dev-server-router-review.md)

---

## Overview

A session gets a **Dev Server** button next to its VS Code, Files and Diff
buttons. It opens `https://<track-slug>-<sid>.<WORKSHOP_DEV_DOMAIN>`, a hostname
that belongs to that session. Workshop receives every request for that hostname,
starts the session's dev server if it is not running, and proxies the request to
it. The track stores the start command.

The dev server runs inside the Workshop container on a loopback port. Docker
publishes nothing new. One wildcard DNS record and one wildcard certificate cover
every session.

## The Problem

Agents work in per-session git worktrees inside the Workshop container on
unraid. To try what an agent built, someone has to start the app's dev server,
and the user has to reach it from a browser.

*   The container publishes only port 3002, so a dev server inside it cannot be
    reached from the LAN or from work.
*   Publishing a port range ([PR #57](https://github.com/devbdavis/workshop/pull/57))
    makes servers reachable, but the user then has to track which session got
    which port, and those ports have no authentication.
*   Starting a server is a chat request to an agent. There is no fixed command
    per project and no single place to find the URL.

## Goals

*   One click from a session opens that session's running app in a new tab.
*   A request to a session hostname whose server is not running starts it.
*   Several sessions can serve at once, and the user never handles port numbers.
*   The same URL works at home and from work. Only a browser that came through
    Workshop's login can open it.
*   Each track stores its own start command.
*   A session's dev server stops when the session is deleted.

## Non-Goals

*   Running dev servers in separate containers. Workshop gets no Docker socket.
*   CI preview builds.
*   More than one exposed port per session. A backend on a second port is
    reached through the frontend's own dev proxy.
*   Idle timeouts, resource limits, a status indicator or a Stop button.
*   Path-based routing (`/dev/<session>/...`).
*   Native installs at `localhost`. The router needs a wildcard domain.

## Decisions

*   **Edge and certificate.** The code depends on only one setting,
    `WORKSHOP_DEV_DOMAIN`. The edge in front of Workshop must route
    `*.<WORKSHOP_DEV_DOMAIN>` to port 3002 and keep the `Host` header.
    `docs/docker.md` covers the edge setups that work. One caveat: Cloudflare's
    free certificate covers only one level below the zone. Setting up DNS and
    the certificate is an operator step, and it must be done before the feature
    can work.
*   **Auth: per-host handoff, not a shared cookie.** A cookie shared across
    `*.workshop.chu.zone` would hand the full Workshop token to every dev app.
    The button instead fetches a ticket valid for 60 seconds:
    `HMAC(auth token, sid, expiry)`. Workshop exchanges it at
    `/__workshop/auth` for a 7-day `workshop_dev` cookie that is valid for that
    host only. The tickets are stateless, so nothing is stored.
*   **Origin guard.** SameSite compares registrable domains, so dev hosts are
    same-site with Workshop. A page on a dev host could therefore make requests
    that carry Workshop's own `SameSite=Strict` cookie, including opening the
    terminal WebSocket. `extractToken` ignores Workshop credentials on any
    request whose `Origin` is a dev host. One check covers the API, the
    WebSockets and `/code`.
*   **Still open.** Workshop's own `npm run dev` uses fixed ports (3001, 5173)
    and does not read `$PORT`. The Workshop track needs a command that
    respects `$PORT` before it can use this feature.

## Critical User Journeys

1.  **First open.** The user clicks **Dev Server**. A new tab opens on the
    session's host. The handoff sets the cookie and redirects to `/`. The page
    shows "Starting dev server…" and reloads every 2 seconds until the app
    answers.
2.  **Three sessions at once.** Each tab shows its own session's code on its own
    port. The user sees no port numbers.
3.  **From work, not logged in.** Opening a dev URL directly returns 401
    ("Open this dev server from the Dev Server button in Workshop"), and no
    server starts.
4.  **Failure.** The command exits, or it is still not answering after 120
    seconds. The page shows the exit code (or "timed out"), the last 50 log
    lines, and a **Retry** link. A failed server is never restarted
    automatically.
5.  **Session deleted.** Deleting, soft-deleting or purging the session kills
    its dev server, and the hostname returns 404.

## Technical Plan

```text
browser ── https://nozzle-3f9a1c2e4b5d.<WORKSHOP_DEV_DOMAIN>/...
   ▼
edge (TLS) ──► Workshop :3002, Host preserved
   ▼
dev-server-router (first middleware; also first in the 'upgrade' handler)
   ├─ Host is not one label under the dev domain  → next() (normal Workshop)
   ├─ /__workshop/auth?t=<ticket>  → valid: set workshop_dev cookie, 302 /
   ├─ no valid workshop_dev cookie for this sid    → 401
   ├─ sid matches no live session / no dev command → 404
   ├─ /__workshop/retry                            → stop, 302 /
   ├─ ensureDevServer()
   │     running  → proxy with credentials stripped, Host = 127.0.0.1:<port>
   │     starting → 503 ("Starting…" refresh page for HTML GETs)
   │     exited   → 502 page with exit code, log tail, Retry link
   └─ WebSocket upgrades: same checks; anything but running → status line + close
```

*   **Hostname.** `<slug>-<sid>`, where `<sid>` is the first 12 hex characters
    of the session UUID (48 bits). The router parses only the `<sid>`, so the
    slug is cosmetic. Prefix collisions are not handled.
*   **Process supervision.** Each session gets a tmux session `dev-<sid>`. It
    runs `bash dev-server.sh` in the session's working directory and receives
    the same `NIX_CLEAN_TMUX_FLAGS` and `TMUX_PATH_FLAG` as agent sessions,
    then `-e PORT=<port>` on top. The script:
    *   loads `direnv` when the directory has an `.envrc`;
    *   runs the command in a subshell piped through `tee`, writing
        `dev-server.log`;
    *   writes `${PIPESTATUS[0]}` to `dev-server.exit`.

    The port and start time are kept in `dev-server.json`. Every one of these
    files lives in `~/.workshop/sessions/<id>/`. While a server is starting,
    concurrent requests share one in-flight start.
*   **Proxy.** `reverse-proxy.ts` holds the HTTP and WebSocket forwarding code
    taken from the code-server proxy. Its `devHost` option does three things:
    *   rewrites `Host`;
    *   replaces client-supplied `x-forwarded-*` headers;
    *   strips the `workshop_token` and `workshop_dev` cookies, a Bearer
        carrying the Workshop token, and `?token=`.

    Without that option, `/code` behaves as it did before.
*   **Data and UI.** The `tracks.dev_command` column backs `Track.devCommand`,
    which is edited in track settings. `GET /api/sessions/:sessionId/dev-server`
    returns `{ url }`. The URL includes a fresh ticket, or is `null` when the
    feature is off or the track has no command. The button appears only when
    `url` is set. It opens a blank tab first, so popup blockers allow it, then
    points the tab at the URL.

## Alternatives Considered

*   **Port range per container (PR #57).** The ports have no authentication, the
    user tracks port numbers, and concurrency is capped by the size of the
    range.
*   **Traefik plus per-repo compose containers.** Needs the Docker socket,
    which is root on the host. Live reload would need host paths for worktrees
    that live inside Workshop's volume.
*   **Path-based routing.** Apps that assume they run at `/` break: absolute
    links, API calls and the HMR client.
*   **Two-level hostnames.** A wildcard certificate covers only one label, so
    each track would need its own certificate.
*   **Shared login cookie.** It exposes the full-control token to dev apps (see
    Decisions).

## Risks and Limits

*   **Vite.** The proxy rewrites `Host` to `127.0.0.1:<port>`, which Vite's host
    check is expected to accept. HMR is expected to connect back through the
    page's own host. Both still need checking on a real deployment.
    Projects that hard-code `server.hmr.clientPort` must drop it.
*   **Absolute redirects.** Apps that redirect to absolute `127.0.0.1` URLs do
    not work through the proxy.
*   **Memory.** Each running dev server holds memory until its session is
    deleted.
*   **One instance only.** Only one Workshop instance may set
    `WORKSHOP_DEV_DOMAIN`, because tmux names and session directories are
    shared.
*   **GET requests.** The Origin guard does not cover GET requests that carry no
    `Origin` header, such as image loads. Those can read nothing across origins,
    so they are only a risk for a GET endpoint with side effects.

## Implementation

| File | Change |
|------|--------|
| `src/server/dev-host.ts` | Hostname build/parse, `devDomain()`, ticket sign/verify |
| `src/server/dev-server-router.ts` | Host-owned router: handoff, auth, retry, start, proxy, upgrades |
| `src/server/reverse-proxy.ts` | Shared HTTP/WS forwarding with the `devHost` option |
| `src/server/code-server-proxy.ts` | Thin caller of `reverse-proxy.ts` |
| `src/server/auth-middleware.ts` | Origin guard in `extractToken` |
| `src/server/dev-server-routes.ts`, `src/server/api.ts` | `GET /sessions/:sessionId/dev-server`; `PUT /tracks/:id` accepts `devCommand` |
| `src/server/index.ts`, `src/server/websocket.ts` | Router mounted first when the domain is set; upgrades routed before the token gate |
| `src/infrastructure/dev-server/dev-server.ts` | `ensureDevServer` / `stopDevServer` |
| `src/infrastructure/net/ports.ts`, `src/infrastructure/code-server/code-server.ts` | Port helpers moved out of code-server and made shared |
| `src/infrastructure/terminal/manager.ts` | Stops the dev server on destroy, soft-delete and purge |
| `src/foundation/types.ts`, `src/domain/track/repository.ts`, `src/infrastructure/persistence/{database,track-repository}.ts` | `devCommand` column and plumbing |
| `src/ui/workspace/WorkspaceButtons.tsx`, `src/ui/track-view/TrackConfig.tsx` | Button and track setting |
| `docker-compose.yml`, `docs/unraid/workshop.xml`, `docs/docker.md`, `docs/features.md` | `WORKSHOP_DEV_DOMAIN` and setup docs |
| `tests/server/dev-host.test.ts`, `tests/server/dev-server-router.test.ts`, `tests/server/dev-server-routes.test.ts`, `tests/infrastructure/dev-server.test.ts`, `tests/domain/track-repository.test.ts` | Unit tests, plus a manager test against real tmux |

**Verification:**
*   **Automated:** `npx vitest run` and `tsc` (server and UI configs).
*   **Manual, after deploying with DNS and the certificate in place:**
    *   CUJ 1 on a Vite project, including an edit that hot-reloads;
    *   CUJ 3 with `curl -i https://<host>/`, expecting 401 and no new
        `dev-*` tmux session;
    *   CUJ 4 with a command that fails;
    *   CUJ 5 by deleting the session and checking `tmux ls`.
