# Consolidated Review: Dev Server Router

*   **Target:** `docs/plans/dev-server-router.md` (commit `ac1aab2`, branch `workshop/dev-server-router`)
*   **Mode:** Consolidated, all stages (5-9), with no edits to the document between stages
*   **Context given to reviewers:** `docs/docker.md`, `src/server/code-server-proxy.ts`, `src/infrastructure/code-server/code-server.ts`
*   **Stage reports:** `zoom_out_report.md`, `comprehension_report.md`, `critic_report.md`, `intermediate_zoom_out_report.md`, `implementation_readiness_report.md`

## Verdict

**Not ready to build.**
- The architecture holds: one wildcard hostname, routed inside Workshop, a tmux-run track command, opt-in through an environment variable. No reviewer argued for replacing it.
- What fails is the detail:
  - Two decisions are still open.
  - The process-supervision spec has a real exit-code bug.
  - The plan misses a domain file and the Nix environment flags.
  - The plan never says how the new manager reaches the code that needs it.

The Stage 8 reviewer judged which of the earlier stages' proposed fixes were worth their cost. This report follows those judgments. Where Stage 9 asked for machinery that Stage 8 rejected, the item is listed under **Contested**.

## Verified against the code (by the orchestrator, not a reviewer)

*   **Confirmed:** `src/server/websocket.ts:68-75` authenticates every WebSocket upgrade by token alone. It never checks `Origin`. With a shared `Domain=.workshop.chu.zone` cookie, any page served from a dev host is same-site, so the browser would attach the cookie. That page could then open Workshop's terminal WebSocket and run shell commands. This turns the shared-cookie option from a privacy risk into **remote shell access for any dev app's front-end code**. See B2.
*   **Refuted:** IR#5's claims that the upgrade path has no auth and that `extractToken` needs an Express `Request`. The central gate at `websocket.ts:69-75` runs first, and `extractToken(req: IncomingMessage)` already works on upgrades.
*   **Refuted:** `tmux -e` needing a version check. The image ships tmux 3.3a, and `-e` needs 3.2.

## 🔴 Blockers

| # | Action | Sources |
|---|--------|---------|
| B1 | Decide the edge (what terminates TLS and issues `*.<domain>`) and record the final hostname scheme. Treat the DNS/certificate setup as a precondition checked before merge. | ZO#1, IC#8, Comp#1-2, D#1, IR#1, CD#11, ZO8-C5 |
| B2 | Decide auth scope. The evidence points to **per-host handoff**: a stateless HMAC ticket of (sid, expiry) keyed on the existing token, swapped for a host-only cookie. No code store and no login redirect. Once decided, delete the other branch (item 6 or item 10). | ZO#2, IC#1, D#2-3, St#3, ZO8-A2/B2, verified above |
| B3 | Fix process supervision. Stage 8 proposes the smallest fix: drop `tee`, the `__EXIT:` line and the log file. Use tmux `remain-on-exit` + `#{pane_dead_status}` for the exit code and `capture-pane` for the log tail. Write the command to a script file and run `bash <script>`, which settles quoting. Use `=dev-<sid>` in every tmux target. | ZO#3, IC#2, Comp#5, IR#2, CD#3, St9#4-5, ZO8-A3 |
| B4 | Add `devCommand` to `TrackRepository.update`'s Pick (`src/domain/track/repository.ts:8`) and to the `api.ts:843-844` destructure. Without it the field is dropped silently and typecheck fails. | CD#1 |
| B5 | Launch dev servers with `NIX_CLEAN_TMUX_FLAGS` and `TMUX_PATH_FLAG` (`manager.ts:85-110`), with `-e PORT` after them. Without them the dev server inherits prod's `NODE_ENV=production`, `PORT=3002` and `WORKSHOP_DB_PATH`. Also decide whether to run the command under `direnv exec .`, so it gets the project's flake environment. | ZO#4, CD#2, ZO8-A4, ZO8-C4 |
| B6 | Define the session lookup: always use 12 hex characters (drop the 8-character form, the 409 response and the fallback), and filter live sessions with `findAll().filter(startsWith && !deletedAt)`. Name the slug function and the 63-character label limit. Name the tmux session `dev-<12hex>`. | ZO#8, IC#6, Comp#3, D#10, St#2, IR#6, CD#5, ZO8-A7 |

## 🟡 Major

| # | Action | Sources |
|---|--------|---------|
| M1 | Wiring: `index.ts` creates one dev-server manager. It goes to `createTerminalManager` as an optional fifth argument, to `ApiRouterDeps` (`api.ts:122`), and to the router. Call `stop` before `cleanupWorktrees` (`manager.ts:921`). Check the other kill paths and `purgeExpiredSessions`. | Comp#8, IR#11, CD#9 |
| M2 | Proxy helper contract: keep `/code` unchanged. Header rewriting (Host, `x-forwarded-*`) and credential stripping (cookie, `?token=`, `Authorization`, client `x-forwarded-*`) are options that only the dev router turns on. Upgrades replace `rawHeaders` entries rather than appending duplicates. Delete `headerOverrides`. Keep `stripPrefix` exported. | ZO#5, IC#5, D#9, ZO8-A5/C1/C2, IR#8-9, CD#7, St9#2 |
| M3 | Router contract: a request whose Host matches the dev domain belongs entirely to the router, including `/api/*` and the SPA fallback. `handleUpgrade` returns `true` for every dev host. It destroys the socket when the session is unknown, starting, or exited. A GET status call never starts a server. | ZO#6, IC#3, ZO8-A6/C3, CD#8, CD#10 |
| M4 | Failure behaviour, in one sentence: timeout (state the value) or exit → kill the session, show `exited` with the log tail, do not restart until the user follows `?retry=1`. That route requires auth. Non-GET requests during startup get 503. | Comp#5, IR#3-4, CD#4, St#4, ZO8-B4/B5 |
| M5 | Shrink v1 to `GET /sessions/:sessionId/dev-server → { url }` and a plain link button in both places it renders. Drop the Stop button, the DELETE route, polling, the status dot and `DevServerStatus`. Update CUJ 1. This also removes the accessibility gap on the dot. | ZO#7, IC#7, ZO8-B10, Comp#6-7, CD#10, CD#14, St9#12 |
| M6 | Move `findFreePort`/`waitForPort` to `src/infrastructure/net/ports.ts`. Give `waitForPort` a generic message. Add `isPortOpen(port)`. | ZO#4, CD#6 |
| M7 | Split the plan into phases, with a typecheck and test run after each: (1) proxy + ports, (2) manager + test, (3) data model + API, (4) router + wiring, (5) UI + docs. | IR#7, CD#12 |
| M8 | Tests: an injectable base directory and timeout for the manager. Skip when tmux or python3 is missing. Router cases: non-dev host, 401, unknown sid, `/api/*` on a dev host, upgrade, retry, credential stripping. Round-trip `devCommand` through the repository. | IR#13, CD#13, ZO#9 |
| M9 | Alternatives: replace "Rejected by author" with the technical reason already in each alternative's cons. | S#2, D#8, St nit |
| M10 | Mark the Vite Host and HMR claims as expected behaviour, to be checked in the CUJ 1 spike. List apps that redirect to absolute `127.0.0.1:PORT` URLs as a known limitation. | D#7, St#1, St9 nit, ZO8-A8 |
| M11 | Promote `Additional Resources` and `Future Improvements` to `##`. Move the Host/HMR paragraph under `### Proxy`. | S#3, S#6 |
| M12 | Say that only one Workshop instance (dev or prod) may set `WORKSHOP_DEV_DOMAIN`. | D#5, ZO8-B8 |

## 🟢 Nit

- Add the CUJ 3 curl check: expect 401 and confirm no tmux session appears. (Comp#14)
- Validate `devCommand`: trim it and store an empty value as NULL, as the existing `x || null` code does. (IR#10, CD#1)
- Note that `x-forwarded-proto` reads `http` behind a TLS edge unless Express's `trust proxy` setting is on. (CD#7)
- Docs placement: `docker.md` after line 75, `features.md` under "Developer Experience". Copy the env syntax from compose and the XML. (CD#15-17)
- Style fixes:
  - Item 1 is a sentence fragment.
  - Item 10's wording.
  - "a port only Workshop can reach" overclaims.
  - "Any number of sessions" can't be measured.
  - The Cloudflare claims need a source.
  - "Typecheck covers lint" overclaims.
  - The provenance footer is duplicated.
  - Name the CUJs in the Verification Plan.

  Sources: St, St9.
- Define the project terms (track, session, soft-delete) in one line each. (Comp#9)

## Contested (proposed, judged not worth the cost)

| Proposal | Source | Why not |
|----------|--------|---------|
| Signed ticket delivered through a login redirect | IC#1 | It adds a signing secret and an open-redirect surface to fix bookmarks for a single user. B2 is enough. |
| Separate Risks & Mitigations section, success metrics, concurrency cap | S#1, D#11 | The NFR section already covers the risks. A cap is listed as a Non-Goal. |
| Orphan sweep at startup, port-reservation set with retry, full state table | IC#2, IC#4, D#4-5, IR#3 | Each is new machinery for a rare failure. Deleting a session already stops its server. M4 covers the crash loop in one sentence. Retry covers a lost port race. |
| Kill the pane's process group rather than the tmux session | IR#12 | Worth one line in the implementation if child processes turn out to survive. Not a design change. |
| Hold requests during startup, push status over WebSocket | IC#3, IC#7 | M5 removes status. M4 handles startup. |
| Proxy timeouts, hop-by-hop headers, abort handling | D#9 | The code-server proxy works without them. Only the upgrade contract and stripping are adopted (M2, M3). |
| Caddy or nginx subprocess, Docker sidecar, extra-port alternatives | D#8 | These contradict the Non-Goals. M9 fixes the rejection wording only. |
| British spelling, "Tiny change", log rotation | St, D#12 | Cosmetic. The log file goes away under B3. |

## Traceability

Codes in the tables above:
- **ZO**: Stage 5, zoom-out.
- **IC**: Stage 5, inventive catalyst.
- **Comp**: Stage 6, comprehension.
- **D, S, St**: Stage 7, design, structure and style.
- **ZO8-xN**: Stage 8. The letter is the section (A accepted, B rejected, C missed) and N the item.
- **IR, CD, St9**: Stage 9, implementation readiness, codebase details and style.

Every numbered finding in the five stage reports appears in at least one row above, or under Contested.
