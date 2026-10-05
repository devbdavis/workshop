# Design Mode — pick a UI element, send it to the agent

Status: **design only, not built.** Orca comparison item #10. The ticket gates it on items 1–7 landing first; as of 2026-10-04 only notifications has (PR #7); command palette, precheck, checkpoints, usage status, inline diff comments and session history are still backlog. Build when that changes or when the gate is explicitly waived.

## What exists today (and what doesn't)

| Need | Today |
|---|---|
| Know a track's dev server URL | Nothing. No port/preview concept on tracks or sessions. |
| Proxy a worktree service into the UI | `src/server/code-server-proxy.ts` — HTTP + WS-upgrade reverse proxy with Workshop token auth, mounted at `/code`. Reusable shape. |
| Put content into an agent's prompt | `TerminalManager.sendInput()` (`src/infrastructure/terminal/manager.ts`) — tmux paste-buffer + Enter. Internal only; no REST route. |
| Images/attachments into a prompt | Nothing. |
| Browser in the container | Nothing. No Playwright/Chromium. |
| Sidecar containers | Nothing. `docker-compose.yml` is one service; unraid template is one container. |

## Cheaper shape than Orca's

Orca streams a per-worktree Chromium. We don't need to: the user already has a browser.

1. **Proxy the dev server into a Workshop pane.** The track gets a `previewUrl` (e.g. `http://localhost:5173`). Workshop reverse-proxies it (same pattern as `code-server-proxy.ts`) and renders it in an iframe. Same origin ⇒ the UI can reach into the iframe's DOM.
2. **Picker runs in the user's browser.** A small script (no injection into the target app's build) attached to the iframe document: hover outline, click to capture `outerHTML` (truncated), a CSS selector, a parent/sibling snippet, and `getComputedStyle` for colour/font/spacing/box. Source file/line: read React dev-mode `_debugSource` / `data-*` hints when present; skip otherwise.
3. **Tray → one attachment.** Staged picks are written to `<worktree>/.workshop/design-picks/<timestamp>.md` (plus PNGs), then `sendInput(sessionId, "Design picks: @.workshop/design-picks/<ts>.md …")`. Claude Code reads `@file` references and image paths natively — no new prompt-attachment mechanism.
4. **Screenshot is the only part that needs a headless browser.** Optional sidecar: a tiny Playwright service (`mcr.microsoft.com/playwright` base) with one endpoint, `POST /shot {url, selector, viewport} → PNG` using `locator.screenshot()`. No streaming. Without the sidecar, picks go without a PNG — everything else still works.
   - Compose: second service under `profiles: [design-mode]`, reached at `http://playwright:3100` via `WORKSHOP_SCREENSHOT_URL`. Unset ⇒ feature degrades.
   - Unraid: separate CA template `docs/unraid/workshop-playwright.xml`; user sets `WORKSHOP_SCREENSHOT_URL` on the main container.
   - Local (non-Docker): `npx playwright install chromium` once and run the same service script with `node`; or leave unset.

Dropped from the ticket's list: the screenshot+crop *streaming* pipeline (replaced by on-demand element shots) and per-worktree Chromium instances (one shared headless browser, one page per request).

## Open problems — decide before building

- **Path-prefix proxying breaks dev servers.** Vite/Next serve absolute paths (`/@vite/client`, `/_next/...`) and an HMR websocket at root. A `/preview/<track>/` prefix needs per-framework `base` config. Alternatives: a port-per-track proxy (needs Docker port ranges mapped — awkward on unraid) or a subdomain per track (needs wildcard DNS). This is the real cost driver; spike it against one Nozzle track first.
- **Where the dev server runs.** Inside the Workshop container (started in the session's tmux)? Then `localhost` works for the proxy but the sidecar needs to reach it — the sidecar must hit Workshop's proxy URL, not `localhost`. Simplest rule: the sidecar always screenshots through Workshop's proxy.
- **Auth for the sidecar** hitting the proxy: pass the Workshop token as a cookie/header on the Playwright context.
- **Viewport parity.** Element shot is taken at the iframe's width, not the user's; pass `viewport` from the iframe's client size.

## Build order, if it goes ahead

1. `previewUrl` on tracks + proxy pane (useful alone: preview the app inside Workshop).
2. Picker + tray + `.workshop/design-picks` + `sendInput` route. Ships value without any Docker change.
3. Playwright sidecar + compose profile + unraid template.

Each step is one PR.
