---
name: pr-watch
description: "Resumes Workshop's PR monitor on a paused PR. Use when the user says 'watch this PR again', 'resume PR monitoring', 'start watching PR N', or otherwise asks Workshop to pick monitoring back up after the automatic 1-hour stale cutoff paused it. Tagged: workshop."
templateName: pr-watch
---

# pr-watch — Resume Workshop's PR monitor

Workshop's PR monitor auto-pauses an open PR one hour after the last observed push if there are no outstanding CI failures or unresolved review comments. Use this skill when the user wants to pick monitoring back up because they're expecting late review feedback (bugbot, human reviewer landing hours later, etc.).

## When NOT to use

- The PR is merged or closed — that's a terminal state, don't resume.
- The PR isn't linked to a Workshop todo — there's no monitor row to resume. Point the user at `/submit-for-review` (or a manual `workshop_update_todo` with `pullRequests`) to register it first.

## Steps

### 1. Identify the PR URL

Try these in order:

1. **Explicit argument.** If the user passed a PR URL or `#<number>` after the slash command, use that. For `#N`, resolve to the current repo via `gh pr view <N> --json url --jq .url`.
2. **Current session.** If `pwd` contains `.workshop/sessions/<session-id>/workspace`, look up the linked todo via the Workshop MCP tools (`workshop_list_todos`, match on `sessionId`) and pull the PR URL from its `pullRequests` array. If the todo has more than one, ask which.
3. **Ask.** If neither works, ask the user for the PR URL.

### 2. Call the resume endpoint

Workshop exposes:

```
POST /api/pr-monitors/resume
Content-Type: application/json

{ "prUrl": "https://github.com/<owner>/<repo>/pull/<n>" }
```

Alternative: pass `{ "todoId": "..." }` to resume every monitor on a todo at once (handy when a todo has multiple PRs). The server:

- Clears the `pause_reason`
- Resets `last_push_at` to now, so the stale clock restarts
- Immediately calls `gh` once to fetch fresh state
- Broadcasts a `pr:updated` WebSocket event so the UI updates

The Workshop dev server usually runs on port 3001, prod on 3002. If the user has both, target whichever they're actively looking at — check with `curl -sf http://localhost:3001/api/tracks | head -c 1` and fall back to 3002.

```bash
curl -sX POST -H 'Content-Type: application/json' \
  -d '{"prUrl":"<url>"}' \
  http://localhost:3001/api/pr-monitors/resume
```

### 3. Report back

One or two lines is plenty:

- PR URL and current state (from the response's `refreshed[0]`)
- What the poll just observed: `checkStatus`, any failing check names, count of unresolved comments
- Note that the panel in the Session view will show the fresh state and any new attention actions

## Edge cases

- **404 "No monitor registered"** — the todo doesn't have this PR in its `pullRequests`. Explain and offer to run `workshop_update_todo` to register it.
- **PR is merged/closed** — the response's `refreshed[0].state` will be `merged` or `closed` and `monitoring` will be `false` with `pauseReason: 'finished'`. Tell the user and don't retry.
- **`gh` auth broken** — the refresh will fail server-side but `resumed` still returns the row. Point the user at `gh auth status`.

## Rules

- Never call `POST /pr-monitors/poll-now` as a substitute — that runs the whole batch, defeats the cooldown, and doesn't handle a paused row correctly. Use `/pr-monitors/resume`.
- Don't register a new monitor from this skill — that's `submit-for-review`'s job (via `workshop_update_todo` + `pullRequests`).
