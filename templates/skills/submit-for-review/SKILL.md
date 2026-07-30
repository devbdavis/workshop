---
name: submit-for-review
description: "Completes a unit of work: updates task tracking, commits staged changes to a branch, and opens a draft PR. Use at the end of a task when work is ready for review. Tagged: workshop."
templateName: submit-for-review
---

Wraps up a finished unit of work — task tracking, git, and a draft PR in one shot.
Always produces a **draft** PR. Never opens a non-draft PR under any circumstances.

## Steps

Run steps 1–2 in parallel, then proceed sequentially.

### 1. Assess git state

- Run `git status` and `git diff --stat` to see what's changed
- Run `git log --oneline -10` to understand recent commit history and naming conventions
- Note the current branch name
- Check for a PR template: look for `.github/pull_request_template.md`, `PULL_REQUEST_TEMPLATE.md`, or files under `.github/PULL_REQUEST_TEMPLATE/`

### 2. Check task tracking

- If Workshop MCP tools are available (`workshop_list_todos`, `workshop_list_workflow_tickets`), query for in-progress todos or tickets that match the work being completed
- Note any items to move to a ready-for-review state after the PR is created

### 3. Stage and commit (if there are uncommitted changes)

- Stage relevant files **explicitly by name** — never use `git add -A` or `git add .`
- Write a concise commit message following the repo's existing style (from step 1 log)
- Append `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` to the commit

If everything is already committed, skip to step 4.

### 4. Create or switch to a feature branch

- If already on a descriptive feature branch (not `main`/`master`/`develop`), stay on it
- Otherwise create a branch with a short kebab-case name that describes the work (e.g. `feat/add-kanban-sort`)
- Push with `-u` to set the upstream: `git push -u origin <branch>`

### 5. Open a draft PR

Construct the PR body:

- If a PR template exists, use it as the base and fill in the sections
- If no template exists, use this structure:
  ```
  ## Summary
  <2-4 bullet points describing what changed and why>

  ## Test plan
  <bulleted checklist of how to verify the changes>

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```

**Describe the change as it stands, never how it came to be.** The reviewer is
deciding whether to approve the current diff. They did not see earlier
iterations and gain nothing from hearing about them.

Cut on sight:

- "Originally this was X", "the prototype had these issues", "we fixed them"
- "This PR shrank from N lines to M", "addresses review feedback", "as discussed"
- "Rebased onto master, which had already changed Y"
- Any fact that is only meaningful relative to a previous version of this PR

A useful test: if a sentence would be deleted by someone who had never seen the
PR before, delete it now.

Lead with what changes and why it is needed. Include only what a reviewer must
know to approve: behavior, blast radius, risk, rollback, merge ordering. Prefer
a short paragraph plus a code or config block over prose narrating the block.
The test plan lists what was actually verified, as evidence — not as a story.

**When updating an existing PR body, rewrite it from the current diff rather
than appending.** Appending is how history accumulates: each round leaves a
sediment layer describing the round before it.

Create the PR against whichever forge the `origin` remote points at:

- **GitHub**:
  ```
  gh pr create --draft --title "<title>" --body "<body>"
  ```
  **`--draft` is mandatory. Never omit it.**

- **Gitea / Forgejo** (any host in `~/.config/tea/config.yml`):
  ```
  tea pulls create --title "WIP: <title>" --description "<body>"
  ```
  `tea` has no `--draft` flag — Gitea derives draft status from a `WIP:` title prefix. **The prefix is mandatory.** Print the PR URL from the command output.

If the user supplied a PR title as an argument, use it. Otherwise derive a short title (≤ 70 chars) from the commit message or branch name.

### 6. Update task tracking

After the PR URL is confirmed:

- If Workshop MCP tools are available:
  - Move any matching in-progress todos to a **ready-for-review** state via `workshop_update_todo` — never mark them `done`. Marking a todo done closes out the session, and the work isn't done until review passes. Record the PR URL in the todo's **resolution** field so the link is preserved.
  - **Also pass `pullRequests: [{ url, title }]`** on the same `workshop_update_todo` call. Workshop's server automatically registers the PR with its background monitor as soon as that field is set — there is no separate call to make. The monitor polls the forge (GitHub via your `gh` CLI auth; Gitea/Forgejo via your `tea` login) every couple of minutes, surfaces failing CI checks and unresolved review comments in the Session view, and offers one-click sub-agent dispatch for "fix the build" or "address comment N". Skipping this means the user loses the post-submit feedback loop.
  - If working within a workflow ticket, transition it to `integration-review` via `workshop_transition_ticket` and include the PR URL in the transition data
- If no Workshop tools are available, skip this step silently

### 7. Report back

Output a brief summary:
- Branch name
- Commit(s) included
- PR URL
- Any task tracking items updated
- Note that Workshop is now monitoring the PR for failing checks and review comments

## Rules

- **Always `--draft`** — no exceptions
- **PR descriptions are current-state only** — no history, no iteration log, no "what changed since last review". Git already records that.
- **Rewrite, never append, when updating a PR body**
- **Default to zero code comments.** Most diffs need none; the reasoning belongs in the PR description, which is where reviewers actually read it. Write a comment only when it is the sole mechanism for a required effect (`# noqa`, a docstring, a build tag), or when correctness depends on something invisible from the file — e.g. a value that must stay in sync with one defined elsewhere. Never explain *why* the code is written the way it is. Never restate what well-named code already shows. If a comment seems necessary to make code understandable, rewrite the code instead. One line where one is genuinely warranted; never a paragraph.
- **Never mark a todo or ticket as `done`** — "done" closes out the session, and review hasn't happened yet. Move items to a ready-for-review state instead.
- **Never update an item's description** — any new information (such as the PR URL) goes in the **resolution** field, not the description.
- Never push to `main`, `master`, or `develop` directly
- Never use `git add -A` or `git add .` — stage files explicitly
- Never skip hooks (`--no-verify`)
- If already on a feature branch with an open PR, update it (push) rather than creating a duplicate
- If there's nothing to commit and no open PR, say so and stop
