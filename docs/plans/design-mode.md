# Design Mode — pick a UI element, send it to the agent

Session header → **Preview**. Enter the dev server URL the session runs (default `http://localhost:5173`), toggle **Pick**, click elements, add a note, **Send**. The agent gets a markdown file with each element's selector, outerHTML, parent HTML, computed styles, box, React source location (React <19 dev builds) and — with the sidecar — a cropped screenshot. Agent edits → HMR reloads the iframe → pick again to verify.

Setup (ports, compose profile, unraid, local): [docker.md → Design Mode](../docker.md).

## How it works

```
browser ── iframe ──▶ Workshop preview port (PORT+100) ──▶ dev server (localhost:5173 in the container)
   │  postMessage           injects /__workshop/picker.js into HTML
   ▼
Workshop UI ── POST /api/sessions/:id/preview/shot ──▶ Playwright sidecar ──▶ preview port (same page, element screenshot)
           └─ POST /api/sessions/:id/preview/send ──▶ ~/.workshop/sessions/<id>/design-picks/<ts>.md + sendInput()
```

- **Own port, not a path prefix.** Dev servers assume they own `/` (absolute asset URLs, HMR socket). A second listener gives them that without colliding with Workshop's routes. Workshop's auth cookie is port-agnostic, so the preview port is gated by the same token; Workshop's cookies are stripped before forwarding.
- **Target in a cookie** (`/__workshop/start?target=&path=`). Keeps the proxy stateless.
- **Picker runs in the user's browser**, so there is no streamed Chromium. It only activates inside an iframe and talks to the parent by `postMessage`, with origin checks on both sides.
- **Screenshots are the only headless-browser work.** The sidecar re-opens the page through the preview port and shoots `locator(selector)`. Without it, picks are sent without images.

## Known limits

- One preview target per browser: the target cookie is per hostname, so two tabs previewing different worktrees overwrite each other's target.
- The sidecar screenshots a fresh page load, not the user's live state (open modals, app login state, scroll position).
- `source` only from React <19 `_debugSource` or `data-source`/`data-inspector-relative-path` attributes.
- Behind an HTTPS reverse proxy, the preview port must be proxied too.
