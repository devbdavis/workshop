---
name: done
description: "Manual-only Workshop task closer. Invoke ONLY when the user explicitly runs `/done` as a slash command. Do NOT auto-trigger on phrases like 'all PRs merged', 'this is shipped', 'close this out', 'mark it done', 'ship it', or 'we're done' — the user has deliberately gated this behind an explicit command so it never fires on its own. When explicitly invoked via `/done`, verifies every PR on the current session's todo is merged, marks the todo done in Workshop (which soft-deletes the terminal session automatically), and reports. Tagged: workshop."
---

# /done — Close a shipped Workshop task

Retires a Workshop task once every PR on it is merged. Three things always happen together at this moment; this skill makes sure none of them is forgotten:

1. **Verify** every PR on the todo actually merged — a todo should never move to `done` with an open PR still hanging around.
2. **Mark the todo `done`** in Workshop so it drops off the Kanban.
3. **Close the linked terminal session** so the recycle bin collects it.

Steps 2 and 3 collapse into a single API call: when a todo moves to `done`, Workshop's server soft-deletes the linked session for you (see `src/server/todo-routes.ts` — the `isMovingToDone` branch calls `terminal.softDeleteSession`). You do not need to kill tmux, exit the shell, or run any cleanup yourself.

## Steps

### 1. Identify the todo

You need the todo's ID. Try these in order:

1. **From the current session.** If `pwd` contains `.workshop/sessions/<session-id>/workspace`, the part between `sessions/` and `/workspace` is the session ID. Call `workshop_list_todos` (optionally `status: 'review'` to narrow the search) and pick the one whose `sessionId` field matches. This is the common case when the skill fires inside a background agent session.
2. **From user context.** If the user named the work — an issue key like "ASY-1402", a PR number, a todo title — look it up via `workshop_list_todos` and match on `issueKey` or `title`.
3. **Ask.** If neither works, list todos in `status: 'review'` and ask the user which one.

### 2. Verify the PRs are merged

The todo object has a `pullRequests` array of `{ url, title? }`. For each entry, check GitHub:

```bash
gh pr view <url> --json state,mergedAt,url
```

A PR counts as shipped only when `state == "MERGED"`. If any PR is `OPEN`, `DRAFT`, or `CLOSED` without a merge, stop and report which one and its state — do not proceed. The user can rerun after the remaining PRs merge.

If `pullRequests` is empty or missing, tell the user plainly: "No PRs recorded on this todo — close it anyway?" Don't silently assume the work shipped. It's also fine to close without PRs for todos that never needed code (research, decisions, etc.), but make that an explicit choice.

### 3. Mark the todo done

One MCP call:

```
workshop_update_todo
  todoId: <todo id>
  status: "done"
  resolution: "<one-line summary of what shipped, if the todo doesn't already have one>"
```

Workshop's server closes the linked terminal session as a side effect of the `done` transition. No further cleanup required.

### 4. Report

Two or three lines is plenty:

- Todo title and ID
- PRs verified, with merge timestamps
- "Session `<id>` soft-deleted." if one was linked, otherwise "No session was linked."

## Example

**User**: "PR is merged, close this one out."

**You**:

1. `pwd` → `/Users/brendan.davis/.workshop/sessions/5fff963d-.../workspace/workshop` → session ID `5fff963d-...`
2. `workshop_list_todos status=review` → find the todo whose `sessionId` matches `5fff963d-...` → todo `49601a56-...`, title "Issue Management", one linked PR (`github.com/.../pull/78`).
3. `gh pr view https://github.com/.../pull/78 --json state,mergedAt` → `{ "state": "MERGED", "mergedAt": "2026-04-18T18:42:00Z" }`.
4. `workshop_update_todo todoId=49601a56-... status=done` → returns the updated todo; server soft-deletes session `5fff963d-...`.
5. Report:
   > Todo **Issue Management** (`49601a56-...`) closed.
   > PR #78 merged 2026-04-18 18:42 UTC.
   > Session `5fff963d-...` moved to recycle bin.

## Edge cases

- **Some PRs merged, some not.** Stop. List the unmerged PRs with their current state. The user can reopen this skill once the rest land.
- **User asks to force-close despite an unmerged PR.** Only honor that if they explicitly say so ("close it anyway", "I know, do it"). Call out loudly in the report that PR verification was skipped.
- **Todo is already `done`.** No-op. Mention that it's already closed and report the existing resolution if present.
- **No Workshop MCP tools available.** This skill is workshop-specific. If `workshop_update_todo` isn't in the toolset, report the fact and stop — don't try to fake it with HTTP calls.
- **Session already gone (recycle bin).** Not an error — `done` transitions are idempotent on that path.

## Rules

- Never mark a todo `done` with an unmerged PR unless the user explicitly overrides.
- Use `workshop_update_todo` with `status: "done"`. Never `workshop_delete_todo` — that is destructive; `done` is archival.
- Don't manually kill tmux, send `exit`, or hit any session-deletion endpoint. The `done` transition handles it, and duplicating the cleanup risks racing with the server's own soft-delete.
